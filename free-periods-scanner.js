const BASE_DIR = 'registry/v2/files';
const OUTPUT_FILE = 'free-periods.json';
const INDEX_FILE = 'registry/v2/index.json';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/**
 * Get timetables from index.json
 */
async function getTimetablesFromIndex() {
  const indexData = await Bun.file(INDEX_FILE).json();
  const timetables = [];
  
  for (const [year, branches] of Object.entries(indexData.timetables)) {
    for (const [branchSection, semesters] of Object.entries(branches)) {
      for (const semester of semesters) {
        timetables.push({ year, branchSection, semester });
      }
    }
  }
  
  return timetables;
  
  return { year, branchSection, semester: semesterFile };
}

/**
 * Evaluate a slot to determine all possible values it can have
 */
function evaluateSlot(slotDef, config) {
  const possibleValues = new Set();
  
  if (!slotDef || !slotDef.choices) {
    possibleValues.add('FREE');
    return possibleValues;
  }

  // Simple format: single config key
  if (typeof slotDef.match === 'string') {
    const configKey = slotDef.match;
    const choices = slotDef.choices;
    
    if (!config[configKey]) {
      // No config defined, might default to FREE
      possibleValues.add('FREE');
      return possibleValues;
    }
    
    const configValues = config[configKey].values.map(v => v.id);
    
    // Check each possible config value
    for (const configValue of configValues) {
      if (choices[configValue]) {
        possibleValues.add(choices[configValue]);
      } else {
        possibleValues.add('FREE');
      }
    }
  } 
  // Complex format: multiple config keys
  else if (Array.isArray(slotDef.match)) {
    const choices = slotDef.choices;
    
    // Generate all possible config combinations
    const configKeys = slotDef.match;
    const configValueArrays = configKeys.map(key => {
      if (!config[key]) return [null];
      return config[key].values.map(v => v.id);
    });
    
    // Cartesian product of all config values
    function cartesian(arrays) {
      if (arrays.length === 0) return [[]];
      const [first, ...rest] = arrays;
      const restProduct = cartesian(rest);
      return first.flatMap(x => restProduct.map(y => [x, ...y]));
    }
    
    const combinations = cartesian(configValueArrays);
    
    for (const combo of combinations) {
      let matched = false;
      
      for (const choice of choices) {
        const pattern = choice.pattern;
        let matches = true;
        
        for (let i = 0; i < pattern.length; i++) {
          if (pattern[i] !== '*' && pattern[i] !== combo[i]) {
            matches = false;
            break;
          }
        }
        
        if (matches) {
          possibleValues.add(choice.value);
          matched = true;
          break;
        }
      }
      
      if (!matched) {
        possibleValues.add('FREE');
      }
    }
  }
  
  return possibleValues;
}

/**
 * Analyze a timetable file to find free periods
 */
async function analyzeTimetable(year, branchSection, semester) {
  try {
    const filePath = `${BASE_DIR}/${year}/${branchSection}/${semester}.json`;
    const data = await Bun.file(filePath).json();
    
    const freePeriods = [];
    
    const schedule = data.schedule || {};
    const slots = data.slots || {};
    const config = data.config || {};
    
    for (const day of DAYS) {
      if (!schedule[day]) continue;
      
      const periods = schedule[day];
      
      for (let periodIndex = 0; periodIndex < periods.length; periodIndex++) {
        const periodValue = periods[periodIndex];
        
        // Check if directly FREE
        if (periodValue === 'FREE') {
          freePeriods.push({
            year,
            branchSection,
            semester,
            day,
            period: periodIndex,
            type: 'always'
          });
        }
        // Check if it's a slot that could be FREE
        else if (slots[periodValue]) {
          const possibleValues = evaluateSlot(slots[periodValue], config);
          
          if (possibleValues.has('FREE')) {
            // Check if it's sometimes free or always free
            const type = possibleValues.size === 1 ? 'always' : 'conditional';
            
            freePeriods.push({
              year,
              branchSection,
              semester,
              day,
              period: periodIndex,
              type,
              slot: periodValue
            });
          }
        }
      }
    }
    
    return freePeriods;
  } catch (error) {
    console.error(`Error processing ${year}/${branchSection}/${semester}:`, error.message);
    return [];
  }
}

/**
 * Build the output structure organized by day -> year -> section -> semester
 */
function buildOutputStructure(allFreePeriods) {
  const output = {
    version: 2,
    generated: new Date().toISOString(),
    freePeriods: {}
  };
  
  for (const fp of allFreePeriods) {
    const { year, branchSection, semester, day, period, type, slot } = fp;
    
    if (!output.freePeriods[day]) {
      output.freePeriods[day] = {};
    }
    
    if (!output.freePeriods[day][year]) {
      output.freePeriods[day][year] = {};
    }
    
    if (!output.freePeriods[day][year][branchSection]) {
      output.freePeriods[day][year][branchSection] = {};
    }
    
    if (!output.freePeriods[day][year][branchSection][semester]) {
      output.freePeriods[day][year][branchSection][semester] = [];
    }
    
    const entry = {
      period,
      type
    };
    
    if (slot) {
      entry.slot = slot;
    }
    
    output.freePeriods[day][year][branchSection][semester].push(entry);
  }
  
  return output;
}

/**
 * Check if two timetables share at least one free period
 */
function shareFreePeriod(timetable1, timetable2, output) {
  for (const day of DAYS) {
    const periods1 = output.freePeriods[day]?.[timetable1.year]?.[timetable1.branchSection]?.[timetable1.semester];
    const periods2 = output.freePeriods[day]?.[timetable2.year]?.[timetable2.branchSection]?.[timetable2.semester];
    
    if (!periods1 || !periods2) continue;
    
    const periods1Set = new Set(periods1.map(p => p.period));
    for (const p of periods2) {
      if (periods1Set.has(p.period)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if three timetables share at least one free period
 */
function shareFreePeriodTriple(t1, t2, t3, output) {
  for (const day of DAYS) {
    const periods1 = output.freePeriods[day]?.[t1.year]?.[t1.branchSection]?.[t1.semester];
    const periods2 = output.freePeriods[day]?.[t2.year]?.[t2.branchSection]?.[t2.semester];
    const periods3 = output.freePeriods[day]?.[t3.year]?.[t3.branchSection]?.[t3.semester];
    
    if (!periods1 || !periods2 || !periods3) continue;
    
    const periods1Set = new Set(periods1.map(p => p.period));
    const periods2Set = new Set(periods2.map(p => p.period));
    
    for (const p of periods3) {
      if (periods1Set.has(p.period) && periods2Set.has(p.period)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if multiple timetables share at least one free period
 */
function shareFreePeriodMultiple(timetables, output) {
  for (const day of DAYS) {
    const periodSets = [];
    
    for (const t of timetables) {
      const periods = output.freePeriods[day]?.[t.year]?.[t.branchSection]?.[t.semester];
      if (!periods) {
        periodSets.push(new Set());
      } else {
        periodSets.push(new Set(periods.map(p => p.period)));
      }
    }
    
    if (periodSets.length === 0) continue;
    
    // Find intersection of all sets
    const firstSet = periodSets[0];
    for (const period of firstSet) {
      let inAll = true;
      for (let i = 1; i < periodSets.length; i++) {
        if (!periodSets[i].has(period)) {
          inAll = false;
          break;
        }
      }
      if (inAll) return true;
    }
  }
  return false;
}

/**
 * Calculate sharing statistics for a set of timetables
 */
function calculateStatsForGroup(timetables, output) {
  const n = timetables.length;
  
  // Helper to calculate nCr (combinations)
  const nCr = (n, r) => {
    if (r > n) return 0;
    let result = 1;
    for (let i = 0; i < r; i++) {
      result *= (n - i);
      result /= (i + 1);
    }
    return result;
  };
  
  // Count pairs
  let pairCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shareFreePeriod(timetables[i], timetables[j], output)) {
        pairCount++;
      }
    }
  }
  
  // Count triples
  let tripleCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        if (shareFreePeriodTriple(timetables[i], timetables[j], timetables[k], output)) {
          tripleCount++;
        }
      }
    }
  }
  
  // Count 4-tuples
  let quadCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        for (let l = k + 1; l < n; l++) {
          if (shareFreePeriodMultiple([timetables[i], timetables[j], timetables[k], timetables[l]], output)) {
            quadCount++;
          }
        }
      }
    }
  }
  
  // Count 5-tuples
  let quintCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        for (let l = k + 1; l < n; l++) {
          for (let m = l + 1; m < n; m++) {
            if (shareFreePeriodMultiple([timetables[i], timetables[j], timetables[k], timetables[l], timetables[m]], output)) {
              quintCount++;
            }
          }
        }
      }
    }
  }
  
  return {
    pairs: { count: pairCount, total: nCr(n, 2) },
    triples: { count: tripleCount, total: nCr(n, 3) },
    quads: { count: quadCount, total: nCr(n, 4) },
    quints: { count: quintCount, total: nCr(n, 5) }
  };
}

/**
 * Calculate sharing statistics by year
 */
function calculateSharingStats(timetables, output) {
  console.log('\nCalculating sharing statistics by year...');
  
  // Group by year
  const byYear = new Map();
  for (const t of timetables) {
    if (!byYear.has(t.year)) {
      byYear.set(t.year, []);
    }
    byYear.get(t.year).push(t);
  }
  
  // Sort years descending
  const sortedYears = Array.from(byYear.keys()).sort((a, b) => b.localeCompare(a));
  
  for (const year of sortedYears) {
    const yearTimetables = byYear.get(year);
    console.log(`\n=== Year ${year} (${yearTimetables.length} timetables) ===`);
    
    const stats = calculateStatsForGroup(yearTimetables, output);
    
    console.log(`Pairs: ${stats.pairs.count} / ${stats.pairs.total} (${(stats.pairs.count / stats.pairs.total * 100).toFixed(1)}%)`);
    console.log(`3-tuples: ${stats.triples.count} / ${stats.triples.total} (${(stats.triples.count / stats.triples.total * 100).toFixed(1)}%)`);
    console.log(`4-tuples: ${stats.quads.count} / ${stats.quads.total} (${(stats.quads.count / stats.quads.total * 100).toFixed(1)}%)`);
    console.log(`5-tuples: ${stats.quints.count} / ${stats.quints.total} (${(stats.quints.count / stats.quints.total * 100).toFixed(1)}%)`);
  }
}

/**
 * Analyze temporal patterns of free periods
 */
function analyzeTemporalPatterns(timetables, output) {
  console.log('\n\n=== TEMPORAL ANALYSIS ===');
  
  // Count how many timetables have each day/period combination free
  const slotCounts = new Map();
  
  for (const day of DAYS) {
    for (let period = 0; period < 7; period++) {
      slotCounts.set(`${day}-${period}`, { day, period, count: 0, timetables: [] });
    }
  }
  
  // Count occurrences
  for (const t of timetables) {
    for (const day of DAYS) {
      const periods = output.freePeriods[day]?.[t.year]?.[t.branchSection]?.[t.semester];
      if (!periods) continue;
      
      for (const p of periods) {
        const key = `${day}-${p.period}`;
        const entry = slotCounts.get(key);
        if (entry) {
          entry.count++;
          entry.timetables.push(`${t.year}/${t.branchSection}/${t.semester}`);
        }
      }
    }
  }
  
  // Convert to array and sort by count
  const sortedSlots = Array.from(slotCounts.values())
    .sort((a, b) => b.count - a.count);
  
  // Top 10 most popular free periods
  console.log('\nTop 10 Most Popular Free Periods:');
  for (let i = 0; i < Math.min(10, sortedSlots.length); i++) {
    const slot = sortedSlots[i];
    if (slot.count === 0) break;
    const percentage = (slot.count / timetables.length * 100).toFixed(1);
    console.log(`  ${i + 1}. ${slot.day} Period ${slot.period + 1}: ${slot.count}/${timetables.length} (${percentage}%)`);
  }
  
  // Least popular free periods (non-zero)
  const nonZeroSlots = sortedSlots.filter(s => s.count > 0);
  console.log('\nLeast Popular Free Periods (that exist):');
  for (let i = Math.max(0, nonZeroSlots.length - 5); i < nonZeroSlots.length; i++) {
    const slot = nonZeroSlots[i];
    const percentage = (slot.count / timetables.length * 100).toFixed(1);
    console.log(`  ${slot.day} Period ${slot.period + 1}: ${slot.count}/${timetables.length} (${percentage}%)`);
  }
  
  // Day-wise analysis
  console.log('\nFree Period Coverage by Day:');
  for (const day of DAYS) {
    const daySlots = sortedSlots.filter(s => s.day === day);
    const totalCount = daySlots.reduce((sum, s) => sum + s.count, 0);
    const avgPerPeriod = totalCount / 7;
    const maxSlot = daySlots.reduce((max, s) => s.count > max.count ? s : max, { count: 0, period: -1 });
    
    console.log(`  ${day}: Avg ${avgPerPeriod.toFixed(1)} timetables/period, Peak: Period ${maxSlot.period + 1} (${maxSlot.count} timetables)`);
  }
  
  // Period-wise analysis (across all days)
  console.log('\nFree Period Coverage by Period Number:');
  for (let period = 0; period < 7; period++) {
    const periodSlots = sortedSlots.filter(s => s.period === period);
    const totalCount = periodSlots.reduce((sum, s) => sum + s.count, 0);
    const avgPerDay = totalCount / DAYS.length;
    
    console.log(`  Period ${period + 1}: Avg ${avgPerDay.toFixed(1)} timetables/day`);
  }
  
  // Best meeting times (slots where most timetables are free)
  console.log('\nBest Meeting Times (slots with 10+ timetables free):');
  const goodSlots = sortedSlots.filter(s => s.count >= 10);
  if (goodSlots.length === 0) {
    console.log('  None found');
  } else {
    for (const slot of goodSlots.slice(0, 15)) {
      console.log(`  ${slot.day} Period ${slot.period + 1}: ${slot.count} timetables (${(slot.count / timetables.length * 100).toFixed(1)}%)`);
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('Scanning v2 timetable files for FREE periods...');
  
  const timetables = await getTimetablesFromIndex();
  console.log(`Found ${timetables.length} timetable files`);
  
  const allFreePeriods = [];
  
  for (const { year, branchSection, semester } of timetables) {
    const freePeriods = await analyzeTimetable(year, branchSection, semester);
    allFreePeriods.push(...freePeriods);
  }
  
  console.log(`Found ${allFreePeriods.length} free period locations`);
  
  const output = buildOutputStructure(allFreePeriods);
  
  await Bun.write(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Results written to ${OUTPUT_FILE}`);
  
  // Print summary
  const days = Object.keys(output.freePeriods);
  console.log('\nSummary by day:');
  for (const day of days) {
    let totalPeriods = 0;
    
    for (const year of Object.keys(output.freePeriods[day])) {
      for (const branch of Object.keys(output.freePeriods[day][year])) {
        for (const semester of Object.keys(output.freePeriods[day][year][branch])) {
          totalPeriods += output.freePeriods[day][year][branch][semester].length;
        }
      }
    }
    
    console.log(`  ${day}: ${totalPeriods} free periods`);
  }
  
  // Calculate sharing statistics
  calculateSharingStats(timetables, output);
  
  // Analyze temporal patterns
  analyzeTemporalPatterns(timetables, output);
}

main();
