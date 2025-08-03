import fs from "node:fs";
import path from "node:path";

const rootDir = "registry/files";
const years = fs.readdirSync(rootDir);

// Validation functions
function validateScheduleConstraints(filePath, data) {
  const errors = [];
  
  if (!data.subjects || !data.schedule) {
    errors.push(`Missing subjects or schedule object`);
    return errors;
  }
  
  const subjects = data.subjects;
  const schedule = data.schedule;
  
  // Check each day's schedule
  for (const [day, daySchedule] of Object.entries(schedule)) {
    if (!Array.isArray(daySchedule)) {
      errors.push(`${day}: Schedule is not an array`);
      continue;
    }
    
    // Validate subject references and slot counting
    let totalSlots = 0;
    
    for (let i = 0; i < daySchedule.length; i++) {
      const entry = daySchedule[i];
      
      if (entry === "FREE") {
        totalSlots += 1;
        continue;
      }
      
      // Check if entry ends with _LAB
      if (entry.endsWith("_LAB")) {
        const subjectKey = entry.replace("_LAB", "");
        
        // Check if subject exists
        if (!subjects[subjectKey]) {
          errors.push(`${day}: Subject "${subjectKey}" (from "${entry}") not found in subjects`);
        }
        
        // Check LAB slot constraints
        if (![0, 3, 5].includes(totalSlots)) {
          errors.push(`${day}: LAB entry "${entry}" can only be in slots 0, 3, or 5 (found in slot ${totalSlots})`);
        }
        
        // LAB uses 3 slots if at start of day, 2 otherwise
        if (totalSlots === 0) {
          totalSlots += 3;
        } else {
          totalSlots += 2;
        }
      } else {
        // Regular entry
        if (!subjects[entry]) {
          errors.push(`${day}: Subject "${entry}" not found in subjects`);
        }
        totalSlots += 1;
      }
    }
    
    // Check if total slots add up to 7
    if (totalSlots !== 7) {
      errors.push(`${day}: Total slots should be 7, but got ${totalSlots}`);
    }
  }
  
  return errors;
}

function validateJsonFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const errors = validateScheduleConstraints(filePath, data);
    
    if (errors.length > 0) {
      console.error(`\nValidation errors in ${filePath}:`);
      errors.forEach(error => console.error(`  - ${error}`));
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`\nError reading/parsing ${filePath}:`, error.message);
    return false;
  }
}

const outputData = {};
outputData.version = 1;
outputData.timetables = {};

let validationPassed = true;
let totalFiles = 0;
let validFiles = 0;

for (const year of years) {
  const yearPath = path.join(rootDir, year);
  const branches = fs.readdirSync(yearPath);
  outputData.timetables[year] = {};
  
  for (const branch of branches) {
    const branchPath = path.join(yearPath, branch);
    const jsonFiles = fs.readdirSync(branchPath).filter(file => file.endsWith('.json'));
    const sems = jsonFiles.map((str) => path.basename(str, ".json"));
    outputData.timetables[year][branch] = sems;
    
    // Validate each JSON file
    for (const jsonFile of jsonFiles) {
      const filePath = path.join(branchPath, jsonFile);
      totalFiles++;
      
      console.log(`Validating: ${path.relative(rootDir, filePath)}`);
      const isValid = validateJsonFile(filePath);
      
      if (isValid) {
        validFiles++;
      } else {
        validationPassed = false;
      }
    }
  }
}

console.log(`\n=== Validation Summary ===`);
console.log(`Total files checked: ${totalFiles}`);
console.log(`Valid files: ${validFiles}`);
console.log(`Invalid files: ${totalFiles - validFiles}`);

if (validationPassed) {
  console.log(`✅ All files passed validation!`);
  fs.writeFileSync("registry/index.json", JSON.stringify(outputData, null, 2), "utf-8");
  console.log(`Generated registry/index.json successfully.`);
} else {
  console.log(`❌ Some files failed validation. Please fix the errors above.`);
  process.exit(1);
}
