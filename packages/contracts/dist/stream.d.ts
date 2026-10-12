import { z } from "zod";
export declare const streamEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    turnId: z.ZodUUID;
    type: z.ZodLiteral<"turn_started">;
}, z.core.$strip>, z.ZodObject<{
    turnId: z.ZodUUID;
    type: z.ZodLiteral<"progress">;
    stage: z.ZodEnum<{
        charting: "charting";
        composing: "composing";
        querying: "querying";
        thinking: "thinking";
    }>;
    message: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    turnId: z.ZodUUID;
    type: z.ZodLiteral<"chart_ready">;
    chart: z.ZodObject<{
        id: z.ZodUUID;
        spec: z.ZodDiscriminatedUnion<[z.ZodObject<{
            title: z.ZodString;
            resultRef: z.ZodUUID;
            x: z.ZodString;
            y: z.ZodString;
            type: z.ZodLiteral<"bar">;
        }, z.core.$strip>, z.ZodObject<{
            title: z.ZodString;
            resultRef: z.ZodUUID;
            x: z.ZodString;
            y: z.ZodString;
            type: z.ZodLiteral<"line">;
        }, z.core.$strip>, z.ZodObject<{
            title: z.ZodString;
            resultRef: z.ZodUUID;
            x: z.ZodString;
            y: z.ZodString;
            type: z.ZodLiteral<"stacked_bar">;
            series: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            title: z.ZodString;
            resultRef: z.ZodUUID;
            type: z.ZodLiteral<"table">;
            columns: z.ZodArray<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            title: z.ZodString;
            resultRef: z.ZodUUID;
            type: z.ZodLiteral<"kpi">;
            column: z.ZodString;
            row: z.ZodNumber;
        }, z.core.$strip>], "type">;
        data: z.ZodObject<{
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
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    turnId: z.ZodUUID;
    type: z.ZodLiteral<"analysis_ready">;
    analysis: z.ZodObject<{
        narrative: z.ZodString;
        caveats: z.ZodArray<z.ZodString>;
        resultRefs: z.ZodArray<z.ZodUUID>;
        chartIds: z.ZodArray<z.ZodUUID>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    turnId: z.ZodUUID;
    type: z.ZodLiteral<"turn_finished">;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    error: z.ZodNullable<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>], "type">;
export type StreamEvent = z.infer<typeof streamEventSchema>;
export declare function readEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent>;
