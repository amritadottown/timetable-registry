import path from "node:path";
import { Glob } from "bun";
import { TimetableSchema } from "./schema.ts";
import { type } from 'arktype';

const rootDir = "registry/v2/files";

function validateSemantics(data) {
  const errors = [];
  const { subjects = {}, config = {}, slots = {}, schedule = {} } = data;

  // 1. Validate subject keys don't end with _LAB
  for (const key of Object.keys(subjects)) {
    if (key.endsWith("_LAB")) {
      errors.push(`Subject key "${key}" should not end with _LAB (reserved for schedule)`);
    }
  }

  // 2. Validate config value ID uniqueness
  for (const [configKey, configOption] of Object.entries(config)) {
    const ids = configOption.values.map(v => v.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      errors.push(`Config "${configKey}" has duplicate value IDs`);
    }
  }

  // 3. Validate slots
  for (const [slotName, slot] of Object.entries(slots)) {
    const isComplexSlot = Array.isArray(slot.match);
    
    if (isComplexSlot) {
      // === ComplexSlot validation ===
      
      // Validate match references
      for (const matchKey of slot.match) {
        if (!config[matchKey]) {
          errors.push(`Slot "${slotName}" references non-existent config key "${matchKey}"`);
        }
      }
      
      // Validate pattern array lengths and values
      for (const choice of slot.choices) {
        if (choice.pattern.length !== slot.match.length) {
          errors.push(`Slot "${slotName}" pattern length (${choice.pattern.length}) doesn't match match length (${slot.match.length})`);
        }
        
        // Validate each pattern element is a valid config value ID or wildcard
        for (let i = 0; i < choice.pattern.length; i++) {
          const patternValue = choice.pattern[i];
          const configKey = slot.match[i];
          
          // Skip wildcard
          if (patternValue === "*") continue;
          
          // Check if pattern value is a valid ID for this config option
          const configOption = config[configKey];
          if (configOption) {
            const validIds = configOption.values.map(v => v.id);
            if (!validIds.includes(patternValue)) {
              errors.push(`Slot "${slotName}" pattern value "${patternValue}" is not a valid ID for config "${configKey}" (valid: ${validIds.join(", ")})`);
            }
          }
        }
        
        // Validate output value references valid subject
        if (choice.value !== "FREE" && !validateSubjectReference(choice.value, subjects)) {
          errors.push(`Slot "${slotName}" pattern [${choice.pattern.join(", ")}] references invalid subject "${choice.value}"`);
        }
      }
    } else {
      // === SimpleSlot validation ===
      
      // Validate match reference
      if (!config[slot.match]) {
        errors.push(`Slot "${slotName}" references non-existent config key "${slot.match}"`);
      }
      
      // Validate choice keys are valid config value IDs
      const configOption = config[slot.match];
      if (configOption) {
        const validIds = configOption.values.map(v => v.id);
        for (const choiceKey of Object.keys(slot.choices)) {
          if (!validIds.includes(choiceKey)) {
            errors.push(`Slot "${slotName}" choice key "${choiceKey}" is not a valid ID for config "${slot.match}" (valid: ${validIds.join(", ")})`);
          }
        }
      }
      
      // Validate output values reference valid subjects
      for (const [configValue, subjectRef] of Object.entries(slot.choices)) {
        if (subjectRef !== "FREE" && !validateSubjectReference(subjectRef, subjects)) {
          errors.push(`Slot "${slotName}" choice "${configValue}" references invalid subject "${subjectRef}"`);
        }
      }
    }
  }

  // 6. Validate schedule references
  for (const [day, periods] of Object.entries(schedule)) {
    for (const entry of periods) {
      if (entry === "FREE") continue;

      // Check if it's a slot reference
      if (slots[entry]) continue;

      // Check if it's a subject reference (possibly with _LAB)
      if (validateSubjectReference(entry, subjects)) continue;

      errors.push(`${day}: Entry "${entry}" is not a valid subject, slot, or FREE`);
    }
  }

  return errors;
}

function validateSubjectReference(ref, subjects) {
  // Direct subject reference
  if (subjects[ref]) return true;

  // Lab reference (e.g., "A_LAB" requires subject "A")
  if (ref.endsWith("_LAB")) {
    const baseSubject = ref.replace("_LAB", "");
    if (subjects[baseSubject]) return true;
  }

  return false;
}

async function validateJsonFile(filePath) {
  try {
    const data = await Bun.file(filePath).json();
    
    // Schema validation
    const result = TimetableSchema(data);
    
    if (result instanceof type.errors) {
      console.error(`\nSchema validation errors in ${filePath}:`);
      console.error(result.summary);
      return false;
    }
    
    // Semantic validation
    const semanticErrors = validateSemantics(data, filePath);
    
    if (semanticErrors.length > 0) {
      console.error(`\nSemantic validation errors in ${filePath}:`);
      semanticErrors.forEach(error => console.error(`  - ${error}`));
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`\nError reading/parsing ${filePath}:`, error.message);
    return false;
  }
}

const outputData = {};
outputData.version = 2;
outputData.timetables = {};

let validationPassed = true;
let totalFiles = 0;
let validFiles = 0;

// Export JSON Schema
console.log("Generating JSON Schema...");
const jsonSchema = TimetableSchema.toJsonSchema();
await Bun.write("registry/v2/schema.json", JSON.stringify(jsonSchema, null, 2));
console.log("Generated registry/v2/schema.json\n");

// Find all JSON files in the directory structure
const glob = new Glob("*/*/*.json");

// Build index and validate
for await (const filePath of glob.scan(rootDir)) {
  const fullPath = path.join(rootDir, filePath);
  const [year, section, filename] = filePath.split(path.sep);
  const semester = path.basename(filename, ".json");
  
  // Initialize nested structure if needed
  if (!outputData.timetables[year]) {
    outputData.timetables[year] = {};
  }
  if (!outputData.timetables[year][section]) {
    outputData.timetables[year][section] = [];
  }
  
  // Add semester to index
  outputData.timetables[year][section].push(semester);
  
  // Validate
  totalFiles++;
  console.log(`Validating: ${filePath}`);
  const isValid = await validateJsonFile(fullPath);
  
  if (isValid) {
    validFiles++;
  } else {
    validationPassed = false;
  }
}

console.log(`\n=== Validation Summary ===`);
console.log(`Total files checked: ${totalFiles}`);
console.log(`Valid files: ${validFiles}`);
console.log(`Invalid files: ${totalFiles - validFiles}`);

if (validationPassed) {
  console.log(`✅ All files passed validation!`);
  await Bun.write("registry/v2/index.json", JSON.stringify(outputData, null, 2));
  console.log(`Generated registry/v2/index.json successfully.`);
} else {
  console.log(`❌ Some files failed validation. Please fix the errors above.`);
  process.exit(1);
}
