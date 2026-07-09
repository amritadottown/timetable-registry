import { Component, createSignal, createResource, createMemo, For, Show } from 'solid-js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

interface FreePeriod {
  period: number;
  type: 'always' | 'conditional';
  slot?: string;
}

interface TimetableOption {
  key: string;
  year: string;
  section: string;
  semester: string;
}

interface FreePeriodsData {
  version: number;
  generated: string;
  freePeriods: Record<string, Record<string, Record<string, Record<string, FreePeriod[]>>>>;
}

const fetchFreePeriodsData = async (): Promise<FreePeriodsData> => {
  const response = await fetch('/free-periods.json');
  return response.json();
};

const App: Component = () => {
  const [data] = createResource(fetchFreePeriodsData);
  const [selectedTimetables, setSelectedTimetables] = createSignal<Set<string>>(new Set());

  const timetableOptions = () => {
    if (!data()) return [];
    
    const timetables = new Map<string, TimetableOption>();
    const freePeriodsData = data()!;
    
    for (const day of DAYS) {
      if (!freePeriodsData.freePeriods[day]) continue;
      
      for (const year of Object.keys(freePeriodsData.freePeriods[day])) {
        for (const section of Object.keys(freePeriodsData.freePeriods[day][year])) {
          for (const semester of Object.keys(freePeriodsData.freePeriods[day][year][section])) {
            const key = `${year}/${section}/${semester}`;
            if (!timetables.has(key)) {
              timetables.set(key, { key, year, section, semester });
            }
          }
        }
      }
    }
    
    return Array.from(timetables.values());
  };

  const groupedByYear = () => {
    const options = timetableOptions();
    const byYear = new Map<string, TimetableOption[]>();
    
    for (const option of options) {
      if (!byYear.has(option.year)) {
        byYear.set(option.year, []);
      }
      byYear.get(option.year)!.push(option);
    }
    
    const sorted = Array.from(byYear.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    
    return sorted.map(([year, items]) => ({
      year,
      items: items.sort((a, b) => {
        if (a.section !== b.section) return a.section.localeCompare(b.section);
        return a.semester.localeCompare(b.semester);
      })
    }));
  };

  const toggleTimetable = (key: string) => {
    const newSet = new Set(selectedTimetables());
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    setSelectedTimetables(newSet);
  };

  const commonFreePeriods = createMemo(() => {
    const selected = selectedTimetables();
    const freePeriodsData = data();
    
    if (!freePeriodsData || selected.size === 0) return null;
    
    const selectedList = Array.from(selected).map(key => {
      const [year, section, semester] = key.split('/');
      return { year, section, semester };
    });
    
    const result: Record<string, Array<{ period: number; type: 'always' | 'conditional' }>> = {};
    
    for (const day of DAYS) {
      const periodSets: Map<number, FreePeriod>[] = [];
      
      for (const { year, section, semester } of selectedList) {
        const periods = freePeriodsData.freePeriods[day]?.[year]?.[section]?.[semester];
        if (!periods) {
          periodSets.push(new Map());
          continue;
        }
        
        const periodMap = new Map<number, FreePeriod>();
        for (const p of periods) {
          periodMap.set(p.period, p);
        }
        periodSets.push(periodMap);
      }
      
      if (periodSets.length === 0) {
        result[day] = [];
        continue;
      }
      
      const common: Array<{ period: number; type: 'always' | 'conditional' }> = [];
      const firstSet = periodSets[0];
      
      for (const [period, periodData] of firstSet) {
        let inAll = true;
        let isConditional = periodData.type === 'conditional';
        
        for (let i = 1; i < periodSets.length; i++) {
          if (!periodSets[i].has(period)) {
            inAll = false;
            break;
          }
          if (periodSets[i].get(period)!.type === 'conditional') {
            isConditional = true;
          }
        }
        
        if (inAll) {
          common.push({ period, type: isConditional ? 'conditional' : 'always' });
        }
      }
      
      result[day] = common.sort((a, b) => a.period - b.period);
    }
    
    return result;
  });

  return (
    <div style={{ 
      "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
      "padding": "20px",
      "max-width": "1200px",
      "margin": "0 auto",
      "background": "#f5f5f5",
      "min-height": "100vh"
    }}>
      <h1 style={{ "margin-bottom": "20px", "color": "#333" }}>Free Periods Finder</h1>
      
      <div style={{ 
        "display": "grid", 
        "grid-template-columns": "300px 1fr", 
        "gap": "20px" 
      }}>
        <div style={{ 
          "background": "white", 
          "padding": "20px", 
          "border-radius": "8px", 
          "box-shadow": "0 2px 4px rgba(0,0,0,0.1)",
          "max-height": "80vh",
          "overflow-y": "auto"
        }}>
          <h2 style={{ "font-size": "18px", "margin-bottom": "15px", "color": "#555" }}>
            Select Timetables
          </h2>
          
          <Show when={data.loading}>
            <p>Loading...</p>
          </Show>
          
          <Show when={data.error}>
            <p style={{ "color": "red" }}>Error loading data</p>
          </Show>
          
          <Show when={data()}>
            <For each={groupedByYear()}>
              {(yearGroup) => (
                <div style={{ "margin-bottom": "20px" }}>
                  <div style={{ 
                    "font-weight": "600", 
                    "margin-bottom": "8px", 
                    "color": "#333",
                    "font-size": "16px"
                  }}>
                    {yearGroup.year}
                  </div>
                  
                  <For each={yearGroup.items}>
                    {(item) => (
                      <div style={{ 
                        "display": "flex", 
                        "align-items": "center", 
                        "padding": "6px 0" 
                      }}>
                        <input
                          type="checkbox"
                          id={item.key}
                          checked={selectedTimetables().has(item.key)}
                          onChange={() => toggleTimetable(item.key)}
                          style={{ "margin-right": "8px", "cursor": "pointer" }}
                        />
                        <label 
                          for={item.key}
                          style={{ 
                            "cursor": "pointer", 
                            "font-size": "14px", 
                            "user-select": "none" 
                          }}
                        >
                          {item.section} - Sem {item.semester}
                        </label>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Show>
        </div>
        
        <div style={{ 
          "background": "white", 
          "padding": "20px", 
          "border-radius": "8px", 
          "box-shadow": "0 2px 4px rgba(0,0,0,0.1)" 
        }}>
          <h2 style={{ "font-size": "18px", "margin-bottom": "15px", "color": "#555" }}>
            Common Free Periods
          </h2>
          
          <Show when={!commonFreePeriods()}>
            <div style={{ 
              "text-align": "center", 
              "padding": "40px", 
              "color": "#999" 
            }}>
              Select timetables to find common free periods
            </div>
          </Show>
          
          <Show when={commonFreePeriods()}>
            <For each={Object.entries(commonFreePeriods() ?? {})}>
              {([day, periods]) => {
                return (
                  <div style={{ 
                    "margin-bottom": "20px", 
                    "padding": "15px", 
                    "background": "#f9f9f9", 
                    "border-radius": "6px" 
                  }}>
                    <div style={{ 
                      "font-weight": "600", 
                      "font-size": "16px", 
                      "margin-bottom": "10px", 
                      "color": "#333" 
                    }}>
                      {day}
                    </div>
                    
                    <Show when={periods.length === 0}>
                      <div style={{ "color": "#999", "font-style": "italic" }}>
                        No common free periods
                      </div>
                    </Show>
                    
                    <Show when={periods.length > 0}>
                      <div style={{ 
                        "display": "flex", 
                        "flex-wrap": "wrap", 
                        "gap": "8px" 
                      }}>
                        <For each={periods}>
                          {(p) => (
                            <div
                              style={{ 
                                "background": p.type === 'conditional' ? '#FF9800' : '#4CAF50',
                                "color": "white",
                                "padding": "6px 12px",
                                "border-radius": "4px",
                                "font-size": "14px",
                                "font-weight": "500"
                              }}
                              title={p.type === 'conditional' ? 
                                'Conditionally free (depends on batch/elective)' : 
                                'Always free'}
                            >
                              Period {p.period + 1}
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default App;
