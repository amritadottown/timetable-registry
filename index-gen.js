import fs from "node:fs";
import path from "node:path";

const rootDir = "registry/files";
const years = fs.readdirSync(rootDir);

const outputData = {};
outputData.version = 1;
outputData.timetables = {};

for (const year of years) {
  const yearPath = path.join(rootDir, year);
  const branches = fs.readdirSync(yearPath);
  outputData.timetables[year] = {};
  for (const branch of branches) {
    const branchPath = path.join(yearPath, branch);
    const sems = fs.readdirSync(branchPath).map((str) => str[0]);
    outputData.timetables[year][branch] = sems;
  }
}

fs.writeFileSync("registry/index.json", JSON.stringify(outputData, null, 4), "utf-8");
