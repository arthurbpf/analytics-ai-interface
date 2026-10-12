import { z } from "zod";
export declare const scalarSchema: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>;
export declare const columnSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodEnum<{
        boolean: "boolean";
        date: "date";
        number: "number";
        string: "string";
    }>;
}, z.core.$strip>;
export declare const resultDataSchema: z.ZodObject<{
    columns: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodEnum<{
            boolean: "boolean";
            date: "date";
            number: "number";
            string: "string";
        }>;
    }, z.core.$strip>>;
    rows: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
    complete: z.ZodBoolean;
    totalRows: z.ZodString;
}, z.core.$strip>;
export type ResultData = z.infer<typeof resultDataSchema>;
export declare const queryResultSchema: z.ZodObject<{
    columns: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodEnum<{
            boolean: "boolean";
            date: "date";
            number: "number";
            string: "string";
        }>;
    }, z.core.$strip>>;
    rows: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
    complete: z.ZodBoolean;
    totalRows: z.ZodString;
    ref: z.ZodUUID;
    sql: z.ZodString;
    purpose: z.ZodString;
    jobId: z.ZodString;
    bytesProcessed: z.ZodString;
    bytesBilled: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type QueryResult = z.infer<typeof queryResultSchema>;
