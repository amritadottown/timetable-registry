#!/usr/bin/env python3
"""
Timetable PDF to JSON converter for Amrita timetable registry.

Usage:
    python parse-timetable.py <pdf_file> [--preview] [--output-dir <dir>]
    
Examples:
    python parse-timetable.py "Class TT even sem 2025-2026-1.pdf" --preview
    python parse-timetable.py "Class TT even sem 2025-2026-1.pdf" --output-dir registry/v2/files/2025
"""

import pdfplumber
import json
import re
import sys
import os
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class Subject:
    slot: str
    code: str
    name: str
    faculty: list[str]
    ltpc: str
    department: str
    
@dataclass
class Timetable:
    section: str
    department: str
    classroom: str
    semester: str
    year: str
    subjects: dict[str, Subject] = field(default_factory=dict)
    schedule: dict[str, list[str]] = field(default_factory=dict)

def clean_text(text: str | None) -> str:
    """Clean text by removing extra whitespace and newlines."""
    if text is None:
        return ""
    # Replace newlines with space, collapse multiple spaces
    text = re.sub(r'\s+', ' ', text.strip())
    return text

def parse_section_info(header_text: str) -> dict:
    """Parse section information from header row."""
    info = {
        'section': '',
        'department': '',
        'classroom': '',
        'semester': '',
        'year': '',
        'batch': ''
    }
    
    text = clean_text(header_text)
    
    # Handle MTech sections first: "Section- MTech: DS Sem II", "Section- MTech: CSE sem II"
    mtech_match = re.search(r'Section-?\s*MTech:?\s*([A-Z]+)', text, re.IGNORECASE)
    if mtech_match:
        info['department'] = 'MTech'
        info['section'] = mtech_match.group(1).upper()
    
    # Extract section - patterns like "Section- A: CSE", "Section- D: AI&DS", "Section-E: AIE"
    if not info['section']:
        section_match = re.search(r'Section-?\s*([A-Z](?:\d)?)\s*[:\-]?\s*([A-Z&]+(?:\s*&\s*[A-Z]+)?)', text, re.IGNORECASE)
        if section_match:
            info['section'] = section_match.group(1).strip()
            info['department'] = section_match.group(2).strip().replace(' ', '')
    
    # Alternative patterns like "Section- AIE-D", "Section- CSE-A"
    if not info['section']:
        alt_match = re.search(r'Section-?\s*([A-Z]+)-([A-Z])', text, re.IGNORECASE)
        if alt_match:
            info['department'] = alt_match.group(1)
            info['section'] = alt_match.group(2)
    
    # Extract classroom
    classroom_match = re.search(r'Class\s*Room:?\s*([A-Z]?\s*\d+)', text, re.IGNORECASE)
    if classroom_match:
        info['classroom'] = classroom_match.group(1).strip()
    
    # Extract semester from text first (most reliable)
    sem_match = re.search(r'(?:for\s+)?(\w+)\s+Semester', text, re.IGNORECASE)
    if sem_match:
        sem_word = sem_match.group(1).lower()
        sem_map = {
            'first': '1', 'second': '2', 'third': '3', 'fourth': '4',
            'fifth': '5', 'sixth': '6', 'seventh': '7', 'eighth': '8',
            '1st': '1', '2nd': '2', '3rd': '3', '4th': '4',
            '5th': '5', '6th': '6', '7th': '7', '8th': '8'
        }
        if sem_word in sem_map:
            info['semester'] = sem_map[sem_word]
    
    # Also try numeric semester like "Sem II"
    if not info['semester']:
        roman_match = re.search(r'Sem\s*(I{1,3}|IV|V|VI{0,3})', text, re.IGNORECASE)
        if roman_match:
            roman = roman_match.group(1).upper()
            roman_map = {'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5', 'VI': '6', 'VII': '7', 'VIII': '8'}
            info['semester'] = roman_map.get(roman, '')
    
    # Also try numeric semester
    if not info['semester']:
        num_sem_match = re.search(r'(\d+)(?:st|nd|rd|th)?\s*Sem', text, re.IGNORECASE)
        if num_sem_match:
            info['semester'] = num_sem_match.group(1)
    
    # Calculate year based on semester (for 2025-26 academic year)
    # Sem 2 = 2025 batch (1st year), Sem 4 = 2024 batch (2nd year), Sem 6 = 2023 batch (3rd year), Sem 8 = 2022 batch (4th year)
    sem_to_year = {
        '1': '2025', '2': '2025',
        '3': '2024', '4': '2024',
        '5': '2023', '6': '2023',
        '7': '2022', '8': '2022'
    }
    if info['semester'] in sem_to_year:
        info['year'] = sem_to_year[info['semester']]
    
    # Fallback: detect from year text
    if not info['year']:
        if 'first year' in text.lower():
            info['year'] = '2025'
            if not info['semester']:
                info['semester'] = '2'
        elif 'second year' in text.lower():
            info['year'] = '2024'
            if not info['semester']:
                info['semester'] = '4'
        elif 'third year' in text.lower():
            info['year'] = '2023'
            if not info['semester']:
                info['semester'] = '6'
        elif 'fourth year' in text.lower():
            info['year'] = '2022'
            if not info['semester']:
                info['semester'] = '8'
    
    return info

def parse_faculty(faculty_text: str) -> list[str]:
    """Parse faculty names from text, handling co-instructors."""
    if not faculty_text:
        return []
    
    faculty_text = clean_text(faculty_text)
    
    # Handle both [Co: ...], (Co: ...), and (co: ...) patterns
    # Note: allow optional space before "Co"
    co_patterns = [
        r'\[\s*Co:?\s*:?\s*(.+?)\]',
        r'\(\s*Co:?\s*:?\s*(.+?)\)',
        r'\(\s*co:?\s*:?\s*(.+?)\)',
    ]
    
    co_faculty = []
    main_faculty = faculty_text
    
    for pattern in co_patterns:
        match = re.search(pattern, main_faculty, re.IGNORECASE)
        if match:
            co_text = match.group(1)
            # Split co-faculty by comma
            for f in re.split(r',\s*', co_text):
                f = f.strip()
                f = re.sub(r'^[:\[\]\(\)]\s*', '', f)
                f = re.sub(r'[\[\]\(\)]$', '', f)
                if f and f not in ['Dr.', 'Mr.', 'Ms.', 'Mrs.', 'Prof.', '', 'Co', 'co']:
                    co_faculty.append(f)
            # Remove the co pattern from main text
            main_faculty = re.sub(pattern, '', main_faculty, flags=re.IGNORECASE).strip()
    
    faculty_list = []
    
    # Split main faculty by comma
    if main_faculty:
        for f in re.split(r',\s*', main_faculty):
            f = f.strip()
            # Clean up leading colons or brackets
            f = re.sub(r'^[:\[\]\(\)]\s*', '', f)
            f = re.sub(r'[\[\]\(\)]$', '', f)
            if f and f not in ['Dr.', 'Mr.', 'Ms.', 'Mrs.', 'Prof.', '', 'Co', 'co']:
                faculty_list.append(f)
    
    # Add co-instructors
    faculty_list.extend(co_faculty)
    
    return faculty_list

def parse_subjects_table(rows: list) -> dict[str, Subject]:
    """Parse the subject mapping table from extracted rows."""
    subjects = {}
    
    for row in rows:
        if not row or len(row) < 5:
            continue
        
        # Clean the row and filter out empty cells for better indexing
        cleaned = [clean_text(cell) for cell in row]
        
        # Find subject code first (pattern like 23CSE111)
        code = ''
        code_idx = -1
        for i, cell in enumerate(cleaned):
            if re.match(r'^\d{2}[A-Z]{2,4}\d{2,3}$', cell):
                code = cell
                code_idx = i
                break
        
        if not code or code_idx < 1:
            continue
        
        # Slot is typically just before the code (or 2 positions before if there's an empty cell)
        slot = ''
        for i in range(code_idx - 1, -1, -1):
            if cleaned[i] and cleaned[i] not in ['Slot', 'Subject Code', '']:
                # Validate slot is a letter (A-Z), special like CIR, EVS, FE, or PE-III style
                if re.match(r'^[A-Z]{1,3}$', cleaned[i]) or re.match(r'^PE-?[IVX]+$', cleaned[i], re.IGNORECASE):
                    slot = cleaned[i]
                    break
        
        # For subjects without slot (like Project Phase-I), derive from name
        if not slot:
            # Check if this is a continuation of previous PE slot (multiple elective options)
            row_text = ' '.join(cleaned)
            if 'Project Phase' in row_text:
                slot = 'PROJECT'
            else:
                # Skip rows without identifiable slot
                continue
        
        # Skip header rows
        if slot in ['Slot', 'Subject']:
            continue
        
        # Find L T P CR (pattern like "3 0 2 4" or "2-0-3-3")
        ltpc = ''
        ltpc_idx = code_idx + 1
        for i in range(code_idx + 1, min(code_idx + 4, len(cleaned))):
            cell = cleaned[i]
            if re.match(r'^[\d\s\-]+$', cell) and len(cell) >= 5:
                ltpc = cell.replace('-', ' ')
                ltpc_idx = i
                break
        
        # Subject title is usually after LTPC
        name = ''
        name_idx = ltpc_idx + 1
        for i in range(ltpc_idx + 1, len(cleaned)):
            cell = cleaned[i]
            if cell and not re.match(r'^[\d\s\-]+$', cell):
                # Check if it looks like a name (not faculty)
                if not any(title in cell for title in ['Dr.', 'Mr.', 'Ms.', 'Mrs.', 'Prof.']):
                    name = cell
                    name_idx = i
                    break
                else:
                    # We've hit faculty without finding name - name might be empty
                    break
        
        # Faculty is after title
        faculty_text = ''
        for i in range(name_idx + 1 if name else ltpc_idx + 1, len(cleaned)):
            cell = cleaned[i]
            if cell and any(title in cell for title in ['Dr.', 'Mr.', 'Ms.', 'Mrs.', 'Prof.', 'New Faculty', 'TBD']):
                faculty_text = cell
                break
        
        # Department is usually last non-empty cell
        department = ''
        for cell in reversed(cleaned):
            if cell and cell not in [faculty_text, name, ltpc, code, slot, '']:
                if not any(title in cell for title in ['Dr.', 'Mr.', 'Ms.', 'Mrs.', 'Prof.']):
                    department = cell
                    break
        
        subjects[slot] = Subject(
            slot=slot,
            code=code,
            name=name,
            faculty=parse_faculty(faculty_text),
            ltpc=ltpc,
            department=department
        )
    
    return subjects

def clean_slot_value(value: str) -> str:
    """Clean a slot value from the schedule."""
    value = clean_text(value)
    
    # Remove noise like "ER", "AE", "RB" etc that come from merged cells
    # These are parts of "SATURDAY", "BREAK", "DEPARTURE", etc.
    noise_patterns = [
        r'^[AERUYBHCTNLPO]+$',  # Single noise letters
        r'^K$', r'^AS$',  # Break indicators
    ]
    
    if len(value) <= 2 and re.match(r'^[A-Z]+$', value):
        # Could be a valid slot like "A", "B", or noise
        # Valid slots are single letters or like "CIR"
        if value not in ['K', 'AS'] and len(value) == 1:
            return value
        return ''
    
    # Handle LAB slots - normalize format
    if 'LAB' in value.upper():
        # Extract the base slot letter
        lab_match = re.match(r'^([A-Z])\s*LAB', value, re.IGNORECASE)
        if lab_match:
            return f"{lab_match.group(1)}_LAB"
        return value.replace(' ', '_').upper()
    
    # Special slots
    if value.upper() in ['EVALUATION', 'COUNSELLING', 'PLACEMENT', 'INDUSTRIAL TALK']:
        return value.upper().replace(' ', '_')
    
    # CIR and similar
    if re.match(r'^[A-Z]{2,3}$', value):
        return value
    
    return value

def parse_schedule(rows: list, subjects: dict[str, Subject]) -> dict[str, list[str]]:
    """Parse the schedule from table rows."""
    schedule = {}
    days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    
    valid_slots = set(subjects.keys())
    # Add LAB versions of each subject
    for slot in list(valid_slots):
        valid_slots.add(f"{slot}_LAB")
    # Add common non-subject slots
    valid_slots.update(['FREE', 'COUNSELLING', 'PLACEMENT', 'INDUSTRIAL_TALK'])
    
    # Known noise patterns from merged cells (parts of SATURDAY, BREAK, DEPARTURE, etc.)
    # These are multi-letter patterns that are NOT valid subject slots
    noise_patterns = {
        'ER', 'AE', 'RB', 'HC', 'NU', 'UT', 'RE', 'YA', 'RP', 'ED', 'SU', 'RA',
        'ERB', 'AER', 'RBA', 'RAP', 'RAB', 'SUB', 'FO', 'ERU', 'TRA', 'PED',
        'KAE', 'AET', 'CNUL', 'EYA', 'KA', 'RUTRAPED',  # TEA BREAK, LUNCH, etc noise
        'K', 'AS', 'ET', 'R'  # Time slot indicators and break fragments
    }
    
    for row in rows:
        if not row:
            continue
        
        cleaned = [clean_text(cell) for cell in row]
        
        # Find day name in row
        day_found = None
        day_idx = -1
        for i, cell in enumerate(cleaned):
            for day in days:
                if day.lower() == cell.lower().strip():
                    day_found = day
                    day_idx = i
                    break
            if day_found:
                break
        
        if not day_found:
            continue
        
        # Extract slots after the day name
        slots = []
        
        for cell in cleaned[day_idx+1:]:
            if not cell:
                continue
            
            cell_clean = cell.strip()
            cell_upper = cell_clean.upper()
            
            if not cell_clean:
                continue
            
            # Skip known non-slot text
            if any(skip in cell_upper for skip in ['BREAK', 'DEPARTURE', 'BUS', 'PRAYER', 'TIME-TABLE', 'PRINCIPAL']):
                continue
            
            # Skip multi-character noise that contains newlines
            if '\n' in cell:
                continue
            
            # FIRST: Check for LAB (most specific)
            # Lab duration: 3 slots if first period (8:10-10:25), 2 slots otherwise
            if 'LAB' in cell_upper:
                # Handle PE-III Lab, A LAB, A-LAB, B LAB, B-LAB, etc.
                lab_match = re.match(r'^(PE[-\s]*[IVX]+|[A-Z]+)[-\s]*LAB', cell_clean, re.IGNORECASE)
                if lab_match:
                    lab_slot = lab_match.group(1).upper()
                    # Normalize PE slots
                    pe_lab_match = re.match(r'^PE[-\s]*(I{1,3}|IV|V)$', lab_slot)
                    if pe_lab_match:
                        lab_slot = f"PE-{pe_lab_match.group(1)}"
                    # If this is the first slot, lab takes 3 periods
                    if len(slots) == 0:
                        slots.append(f"{lab_slot}_LAB")
                        slots.append(f"{lab_slot}_LAB")
                        slots.append(f"{lab_slot}_LAB")  # Morning lab = 3 slots
                    else:
                        slots.append(f"{lab_slot}_LAB")
                        slots.append(f"{lab_slot}_LAB")  # Other labs = 2 slots
                continue
            
            # SECOND: Check for special slots
            # EVALUATION = FREE (students have no class)
            if cell_upper == 'EVALUATION':
                slots.append('FREE')
                continue
            
            if cell_upper == 'COUNSELLING':
                slots.append('COUNSELLING')
                continue
                
            if cell_upper == 'PLACEMENT':
                slots.append('PLACEMENT')
                continue
            
            if 'INDUSTRIAL' in cell_upper:
                slots.append('INDUSTRIAL_TALK')
                continue
            
            # BREAK BOUNDARY CHECKS - must come before subject detection
            # After 3 slots (tea break boundary), skip single-letter cells that 
            # are duplicates of what we already have - likely TEA/LUNCH fragments
            if len(slots) == 3 and len(cell_upper) == 1 and cell_upper in slots:
                continue
            
            # After 5 slots (lunch break boundary), single letters C, H are likely
            # from "lunCH" fragments - skip them
            if len(slots) == 5 and len(cell_upper) == 1 and cell_upper in ['C', 'H']:
                continue
            
            # Also skip duplicate single letters at 5-slot boundary
            if len(slots) == 5 and len(cell_upper) == 1 and cell_upper in slots:
                continue
            
            # After 5 slots, if we see PE-III/PE-II etc and haven't seen it in morning,
            # it might be header bleed - skip unless it's actually in the schedule
            # (this is fragile but handles some edge cases)
            if len(slots) >= 5 and re.match(r'^PE[-\s]*(I{1,3}|IV|V)$', cell_upper):
                # Check if any PE slot was already in morning slots
                has_pe_morning = any(s.startswith('PE-') for s in slots[:5])
                if not has_pe_morning:
                    # Might be header bleed, skip
                    continue
            
            # THIRD: Check if it's a valid subject slot (single letter or multi like CIR, FE, FE1)
            # This takes precedence over noise detection
            if cell_upper in subjects:
                slots.append(cell_upper)
                continue
            
            # Handle FE1, FE I, FE 1 variants
            if re.match(r'^FE\s*[1I]?$', cell_upper):
                if 'FE' in subjects:
                    slots.append('FE')
                continue
            
            # Handle PE-III, PE III, PE-II, etc. (Professional Electives)
            pe_match = re.match(r'^PE[-\s]*(I{1,3}|IV|V)$', cell_upper)
            if pe_match:
                # Normalize to PE-III format
                pe_slot = f"PE-{pe_match.group(1)}"
                if pe_slot in subjects:
                    slots.append(pe_slot)
                continue
            
            # Handle CIR-T (CIR Theory) - maps to CIR
            if cell_upper == 'CIR-T' or cell_upper == 'CIR T':
                if 'CIR' in subjects:
                    slots.append('CIR')
                continue
            
            # Handle Project Phase-I, Project Phase-II, etc. (3 slots if morning, 2 otherwise)
            project_match = re.match(r'^PROJECT\s*PHASE[-\s]*(I{1,3}|IV|V|\d)$', cell_upper)
            if project_match:
                # Check if we have a project subject (look for any subject with "Project" in name)
                project_slot = None
                for slot_name, subj in subjects.items():
                    if hasattr(subj, 'name') and 'project' in subj.name.lower():
                        project_slot = slot_name
                        break
                if project_slot:
                    if len(slots) == 0:
                        # Morning project = 3 slots
                        slots.append(project_slot)
                        slots.append(project_slot)
                        slots.append(project_slot)
                    else:
                        # Afternoon project = 2 slots
                        slots.append(project_slot)
                        slots.append(project_slot)
                else:
                    # Use a generic PROJECT slot
                    if len(slots) == 0:
                        slots.append('PROJECT')
                        slots.append('PROJECT')
                        slots.append('PROJECT')
                    else:
                        slots.append('PROJECT')
                        slots.append('PROJECT')
                continue
            
            # FOURTH: Skip known noise patterns (only if not a valid subject)
            if cell_upper in noise_patterns:
                continue
            
            # Skip short strings that look like noise (but allow valid slots like CIR)
            if len(cell_upper) <= 3 and re.match(r'^[A-Z]+$', cell_upper):
                # Only skip if it's NOT a known subject slot
                if cell_upper not in subjects:
                    continue
            
            # Multi-letter slots like CIR, EVS that are in subjects
            if re.match(r'^[A-Z]{2,3}$', cell_upper) and cell_upper in subjects:
                slots.append(cell_upper)
                continue
        
        # Normalize to 7 slots, filling with FREE if needed
        while len(slots) < 7:
            slots.append('FREE')
        
        schedule[day_found] = slots[:7]
    
    return schedule

def generate_short_name(name: str) -> str:
    """Generate a short name from subject title."""
    if not name:
        return "TBD"
    
    # Remove parenthetical content like "(Soft Core-2)"
    name_clean = re.sub(r'\s*\([^)]*\)\s*', '', name).strip()
    
    # Common abbreviations
    abbrevs = {
        'mathematics': 'Math',
        'discrete mathematics': 'DM',
        'linear algebra': 'LA',
        'programming': 'Prog',
        'object oriented': 'OOP',
        'physics': 'Phy',
        'chemistry': 'Chem',
        'english': 'Eng',
        'communication': 'Comm',
        'laboratory': 'Lab',
        'user interface': 'UI',
        'design': 'Des',
        'glimpses of glorious india': 'GGI',
        'deep learning': 'DL',
        'machine learning': 'ML',
        'data structure': 'DS',
        'database': 'DB',
        'operating system': 'OS',
        'computer network': 'CN',
        'software engineering': 'SE',
        'computer vision': 'CV',
        'technical communication': 'TC',
        'probability': 'Prob',
        'algorithms': 'Algo',
        'functional': 'FP',
        'computer organization': 'COA',
        'architecture': 'Arch',
        'leadership': 'Lead',
        'life skills': 'LS',
        'career': 'Career',
        'scientific computing': 'SC',
        'text mining': 'TM',
        'big data': 'BD',
        'cloud computing': 'Cloud',
    }
    
    name_lower = name_clean.lower()
    for key, abbrev in abbrevs.items():
        if key in name_lower:
            return abbrev
    
    # Generate from initials (exclude common words)
    stop_words = {'and', 'of', 'the', 'for', 'in', 'to', 'with', 'a', 'an', 'from'}
    words = [w for w in name_clean.split() if w.lower() not in stop_words]
    if len(words) <= 3:
        return ''.join(w[0].upper() for w in words if w)
    return ''.join(w[0].upper() for w in words[:3] if w)

def convert_to_json_format(timetable: Timetable) -> dict:
    """Convert parsed timetable to the registry JSON format."""
    result = {
        "$schema": "http://timetable-registry.amrita.town/v2/schema.json",
        "subjects": {},
        "config": {},
        "slots": {},
        "schedule": {}
    }
    
    # Convert subjects
    for slot, subject in timetable.subjects.items():
        result["subjects"][slot] = {
            "name": subject.name,
            "code": subject.code,
            "faculty": subject.faculty if subject.faculty else ["TBD"],
            "shortName": generate_short_name(subject.name)
        }
    
    # Convert schedule - only include if it has meaningful content
    # (more than just FREE slots)
    for day, slots in timetable.schedule.items():
        non_free = [s for s in slots if s != 'FREE']
        if non_free:
            result["schedule"][day] = slots
    
    # If schedule is empty, add a placeholder
    if not result["schedule"]:
        result["schedule"] = {
            "Monday": ["FREE"] * 7,
            "Tuesday": ["FREE"] * 7,
            "Wednesday": ["FREE"] * 7,
            "Thursday": ["FREE"] * 7,
            "Friday": ["FREE"] * 7
        }
        result["_note"] = "Schedule needs manual verification from PDF"
    
    return result

def parse_table(table: list, page_num: int) -> Optional[Timetable]:
    """Parse a single table from a PDF page."""
    if not table or len(table) < 5:
        return None
    
    # Combine all text from first few rows to get header info
    header_text = ''
    for row in table[:5]:
        for cell in row:
            if cell:
                header_text += ' ' + str(cell)
    
    section_info = parse_section_info(header_text)
    
    if not section_info.get('section') or not section_info.get('department'):
        return None
    
    timetable = Timetable(
        section=section_info['section'],
        department=section_info['department'],
        classroom=section_info.get('classroom', ''),
        semester=section_info.get('semester', ''),
        year=section_info.get('year', '2025')
    )
    
    # Parse subjects from the mapping table (bottom portion)
    subjects = parse_subjects_table(table)
    timetable.subjects = subjects
    
    # Parse schedule from the day rows
    schedule = parse_schedule(table, subjects)
    timetable.schedule = schedule
    
    return timetable

def parse_pdf(pdf_path: str) -> list[Timetable]:
    """Parse all timetables from a PDF file."""
    timetables = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages, 1):
            tables = page.extract_tables()
            
            for table in tables:
                tt = parse_table(table, page_num)
                if tt and tt.subjects:
                    timetables.append(tt)
                    print(f"Page {page_num}: Found {tt.department} Section {tt.section} ({len(tt.subjects)} subjects)")
    
    return timetables

def get_output_filename(tt: Timetable) -> str:
    """Generate output filename for a timetable."""
    dept_map = {
        'CSE': 'cse',
        'AI': 'aie',
        'AI&DS': 'aid',
        'AIDS': 'aid',
        'AIE': 'aie',
        'ECE': 'ece',
        'EAC': 'eac',
        'EEE': 'eee',
        'ELC': 'elc',
        'MEE': 'mee',
        'RAE': 'rae',
    }
    
    dept = dept_map.get(tt.department.upper(), tt.department.lower())
    section = tt.section.lower()
    semester = tt.semester or '2'
    
    return f"{semester}.json"

def get_output_dir(tt: Timetable, base_dir: str) -> str:
    """Get output directory for a timetable."""
    dept_map = {
        'CSE': 'cse',
        'AI': 'aie',
        'AI&DS': 'aid',
        'AIDS': 'aid',
        'AID': 'aid',
        'AIE': 'aie',
        'ECE': 'ece',
        'EAC': 'eac',
        'EEE': 'eee',
        'ELC': 'elc',
        'MEE': 'mee',
        'RAE': 'rae',
        'MTECH': 'mtech',
        'TECH': 'mtech',  # MTech sections
    }
    
    dept = dept_map.get(tt.department.upper(), tt.department.lower())
    section = tt.section.lower()
    year = tt.year or '2025'
    
    return os.path.join(base_dir, year, f"{dept}-{section}")

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Parse timetable PDF to JSON')
    parser.add_argument('pdf_file', help='Input PDF file')
    parser.add_argument('--preview', action='store_true', help='Preview parsed data without writing files')
    parser.add_argument('--output-dir', default='registry/v2/files', help='Output directory for JSON files')
    parser.add_argument('--page', type=int, help='Parse only specific page number')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.pdf_file):
        print(f"Error: File not found: {args.pdf_file}")
        sys.exit(1)
    
    print(f"Parsing {args.pdf_file}...")
    timetables = parse_pdf(args.pdf_file)
    
    print(f"\nFound {len(timetables)} timetables")
    
    for tt in timetables:
        json_data = convert_to_json_format(tt)
        
        if args.preview:
            print(f"\n{'='*60}")
            print(f"{tt.department} Section {tt.section} (Year {tt.year}, Sem {tt.semester})")
            print(f"Classroom: {tt.classroom}")
            print(f"{'='*60}")
            print("\nSubjects:")
            for slot, subj in tt.subjects.items():
                print(f"  {slot}: {subj.code} - {subj.name}")
                print(f"      Faculty: {', '.join(subj.faculty) if subj.faculty else 'TBD'}")
            print("\nSchedule:")
            for day, slots in tt.schedule.items():
                print(f"  {day}: {slots}")
            print("\nJSON Preview:")
            print(json.dumps(json_data, indent=2)[:1000] + "...")
        else:
            # Write to file
            output_dir = get_output_dir(tt, args.output_dir)
            os.makedirs(output_dir, exist_ok=True)
            
            output_file = os.path.join(output_dir, get_output_filename(tt))
            
            with open(output_file, 'w') as f:
                json.dump(json_data, f, indent=2)
            
            print(f"Written: {output_file}")

if __name__ == '__main__':
    main()
