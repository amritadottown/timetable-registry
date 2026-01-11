# ASEB Timetable Transcription Tutorial

This guide will help you create a JSON timetable file from the canonical timetable published by the department.

## Determining File Location

Before you start, determine the correct folder path. The pattern is `registry/v2/files/<start year>/<branch>-<section>/<semester>.json`.

### Year folder (when students started)

Use this formula: `startYear = currentYear - floor(semester / 2)`

Examples (if current date is January 2026):
- **Semester 2 (Even Sem)**: Students started in 2025 → `2025/`
- **Semester 4**: Students started in 2024 → `2024/`  
- **Semester 6**: Students started in 2023 → `2023/`

### Section

Section numbering is continuous across all branches. This means section A will always be CSE, even though the canonical timetable may show the number restarting from A within a department.

## Overview

A timetable file consists of four main sections:
1. **subjects** - Details about each course
2. **config** - Configuration options (batch, electives, etc.)
3. **slots** - Dynamic mappings for periods that vary by config
4. **schedule** - The weekly schedule grid

## Step 1: Set up the basic structure

Start with this template:

```json
{
  "$schema": "https://timetable-registry.amrita.town/v2/schema.json",
  "subjects": {},
  "config": {},
  "slots": {},
  "schedule": {}
}
```

## Step 2: Add subjects

For each subject, create an entry with a **short key** (A, B, C, etc.) that matches what appears in the schedule grid.

### Example from timetable:

```
A    23CSE301    3 0 2 4    Machine Learning    Dr. Peeta Basa Pati (Co-Dr. Debanjali B)
```

### Becomes:

```json
"subjects": {
  "A": {
    "name": "Machine Learning",
    "code": "23CSE301",
    "faculty": ["Dr. Peeta Basa Pati", "Dr. Debanjali B"],
    "shortName": "ML"
  }
}
```

### Important notes:
- **Split faculty by commas** into separate array items
- Remove text like "(Co-" or "Co-" - just list all faculty members
- The **shortName** can be an abbreviation you create (keep it concise)
- **Subject IDs cannot end with `_LAB`** - use a different key (e.g., `MLL` instead of `ML_LAB`), then reference it with `_LAB` in the schedule

### Labs and the `_LAB` suffix:

The `_LAB` suffix is recognized by the renderer. When you use `A_LAB` in the schedule, it refers to the lab session for subject `A`.

**Lab-integrated courses:**
If lab sessions are part of the same course (same course code), you don't need a separate subject. Just use the theory subject with `_LAB` suffix in the schedule.

Example:
```json
"A": {
  "name": "Machine Learning",
  "code": "23CSE301",
  "faculty": ["Dr. Peeta Basa Pati", "Dr. Debanjali B"],
  "shortName": "ML"
}
```
In schedule: `"A_LAB"` automatically references this subject's lab.

**Separate lab courses:**
Some labs have their own course code (separate from theory). These need their own subject entry with a unique key.

Example:
```json
"CSL": {
  "name": "Communication Systems Laboratory",
  "code": "23ECE384",
  "faculty": ["Dr. Navin Kumar", "Dr. Manoj Kumar Panda"],
  "shortName": "CS Lab"
}
```
In schedule: `"CSL_LAB"` (not just `"CSL"`)

**Important:** Don't include `_LAB` in the shortName - it's only used in the schedule.

## Step 3: Add configuration options

If your section has **variants** (like different batches or electives), define them in `config`.

### Common scenarios:

#### Multiple batches (G1, G2, A1, A2, etc.):
```json
"config": {
  "batch": {
    "label": "Batch",
    "values": [
      { "label": "G1", "id": "g1" },
      { "label": "G2", "id": "g2" }
    ]
  }
}
```

#### Electives:
```json
"config": {
  "elective": {
    "label": "Professional Elective II",
    "values": [
      { "label": "Natural Language Processing", "id": "NLP" },
      { "label": "Robotics", "id": "ROB" }
    ]
  }
}
```

**Note:** The `id` should match subject keys when appropriate (like `"E"` or `"F"`), or be descriptive short codes.

## Step 4: Create slots for dynamic periods

Slots handle periods that change based on config selections. Use slots when:
- Different batches have different labs at the same time
- Elective choices affect the schedule
- Certain periods are FREE for some groups but occupied for others

### Simple format (single config key)

Use when a period depends on **one config option**:

```json
"mondayLab": {
  "match": "batch",
  "choices": {
    "g2": "B_LAB"
  }
}
```

This means:
- If batch is `g2`, show `B_LAB`
- Otherwise, default to `FREE`

Multiple mappings:
```json
"tuesdayLab": {
  "match": "batch",
  "choices": {
    "g1": "CSL_LAB",
    "g2": "C_LAB"
  }
}
```

### Complex format (multiple config keys)

Use when a period depends on **multiple config options**:

```json
"electiveLab": {
  "match": ["batch", "elective"],
  "choices": [
    { "pattern": ["g1", "NLP"], "value": "NLP_LAB" },
    { "pattern": ["g1", "ROB"], "value": "ROB_LAB" },
    { "pattern": ["g2", "*"], "value": "FREE" }
  ]
}
```

- `"*"` is a wildcard matching any value
- Patterns are checked **top to bottom**, first match wins
- If no pattern matches, defaults to `FREE`

### When to use slots:

❌ **Don't use slots for:**
- Periods that are the same for everyone (just use subject key directly)

✅ **Use slots for:**
- Lab swaps between batches
- Elective choices
- Optional periods

### Common patterns

**Pattern 1: Two batches with lab swap**

```json
"config": {
  "batch": {
    "label": "Batch",
    "values": [
      { "label": "G1", "id": "g1" },
      { "label": "G2", "id": "g2" }
    ]
  }
},
"slots": {
  "morningLab": {
    "match": "batch",
    "choices": {
      "g1": "CSL_LAB",
      "g2": "C_LAB"
    }
  }
}
```

**Pattern 2: Elective choice**

```json
"config": {
  "elective": {
    "label": "Professional Elective II",
    "values": [
      { "label": "Digital IC Design", "id": "E" },
      { "label": "Operating Systems", "id": "F" }
    ]
  }
},
"slots": {
  "electiveSlot": {
    "match": "elective",
    "choices": {
      "E": "E",
      "F": "F"
    }
  }
}
```

**Pattern 2b: Multiple professional electives with selective meetings**

When some elective students meet together at certain times:

```json
"config": {
  "pe1": {
    "label": "Professional Elective I",
    "values": [
      { "label": "Physical Design of IC's", "id": "D1" },
      { "label": "Block Chain Technology", "id": "D2" },
      { "label": "Radar Systems", "id": "D3" }
    ]
  }
},
"slots": {
  "pe1All": {
    "match": "pe1",
    "choices": {
      "D1": "D1",
      "D2": "D2",
      "D3": "D3"
    }
  },
  "pe1ExceptD2": {
    "match": "pe1",
    "choices": {
      "D1": "D1",
      "D3": "D3"
    }
  },
  "pe1OnlyD2": {
    "match": "pe1",
    "choices": {
      "D2": "D2"
    }
  }
}
```

This handles cases where:
- All PE1 students meet together (`pe1All`)
- Everyone except Block Chain meets (`pe1ExceptD2`) 
- Only Block Chain meets (`pe1OnlyD2`)

**Pattern 3: Batch has different schedules**

If G1 has a class and G2 is FREE:

```json
"afternoonSlot": {
  "match": "batch",
  "choices": {
    "g1": "B_LAB"
  }
}
```

## Step 5: Build the schedule

Each day must have **exactly 7 periods**.

**Important:** Labs that span multiple hours must be **repeated**:
- Labs at the **start of the day**: repeat **3 times**
- Labs **not at the start**: repeat **2 times**

### Example:

```json
"schedule": {
  "Monday": ["mondayLab", "mondayLab", "mondayLab", "A", "LSE", "LSE", "LSE"],
  "Tuesday": ["tuesdayLab", "tuesdayLab", "tuesdayLab", "D", "A", "tuesdayAfternoon", "tuesdayAfternoon"],
  "Wednesday": ["elective", "A", "D", "LSE", "C", "B", "FREE"],
  "Thursday": ["thursdayLab", "thursdayLab", "thursdayLab", "B", "elective", "C", "D"],
  "Friday": ["B", "elective", "C", "D", "FREE", "OPEN_LAB", "OPEN_LAB"]
}
```

### Using slots in schedule:

Replace subject keys with slot names wherever the period is dynamic:
- `"mondayLab"` instead of `"B_LAB"` (if it varies by batch)
- `"elective"` instead of `"E"` (if it's an elective choice)

## Step 6: Validation checklist

Before finalizing:

- [ ] All subjects referenced in schedule exist in `subjects` or `slots`
- [ ] All slot names referenced in schedule exist in `slots`
- [ ] Each day has exactly 7 periods
- [ ] Faculty names are properly split into arrays
- [ ] Subject codes match pattern `##XXX###` (e.g., `23CSE301`, `24ECE302`)
- [ ] Config IDs are consistent with slot matches
- [ ] All slot outputs reference valid subjects (or FREE)
- [ ] Lab periods are properly repeated (3x at start, 2x elsewhere)

## Getting help

If you encounter validation errors:
- Check that your JSON is valid (commas, quotes, brackets)
- Verify all referenced keys exist
- Ensure arrays have the right number of items
- Check the schema file for exact requirements
