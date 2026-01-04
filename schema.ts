import { type } from "arktype";

const timetableScope = type.scope({
    Subject: {
        "+": "reject",
        name: "string",
        shortName: "string",
        code: /^\d{2}[A-Z]{2,3}\d{3}$/,
        "faculty": "string[]"
    },

    ConfigValue: { label: "string", id: "string" },
    ConfigOption: {
        label: "string",
        values: "ConfigValue[] >= 1"
    },

    SimpleSlot: {
        match: "string",
        "choices": "Record<string, string>"
    },
    ComplexChoice: {
        "pattern": "string[] >= 1",
        value: "string",
    },
    ComplexSlot: {
        "match": "string[] >= 1",
        "choices": "ComplexChoice[] >= 1",
    },
    Slot: "SimpleSlot | ComplexSlot",

    Timetable: {
        subjects: "Record<string, Subject>",
        config: "Record<string, ConfigOption>",
        slots: "Record<string, SimpleSlot | ComplexSlot>",
        schedule: {
            "+": "reject",
            "Monday?": "string[] == 7",
            "Tuesday?": "string[] == 7",
            "Wednesday?": "string[] == 7",
            "Thursday?": "string[] == 7",
            "Friday?": "string[] == 7",
            "Saturday?": "string[] == 7",
            "Sunday?": "string[] == 7"
        }
    }
}).export()

export const TimetableSchema = timetableScope.Timetable
