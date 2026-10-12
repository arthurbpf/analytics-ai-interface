import { z } from "zod";
export declare const idSchema: z.ZodUUID;
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
export declare const chartSpecSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
export declare const publishedChartSchema: z.ZodObject<{
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
export declare const analysisSchema: z.ZodObject<{
    narrative: z.ZodString;
    caveats: z.ZodArray<z.ZodString>;
    resultRefs: z.ZodArray<z.ZodUUID>;
    chartIds: z.ZodArray<z.ZodUUID>;
}, z.core.$strip>;
export declare const terminalStatusSchema: z.ZodEnum<{
    completed: "completed";
    failed: "failed";
    interrupted: "interrupted";
}>;
export declare const turnStatusSchema: z.ZodEnum<{
    completed: "completed";
    failed: "failed";
    interrupted: "interrupted";
    running: "running";
}>;
export declare const apiErrorSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
}, z.core.$strip>;
export declare const turnRequestSchema: z.ZodObject<{
    message: z.ZodString;
    clientTurnId: z.ZodUUID;
}, z.core.$strip>;
export declare const sessionSchema: z.ZodObject<{
    id: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strip>;
export declare const turnSchema: z.ZodObject<{
    id: z.ZodUUID;
    clientTurnId: z.ZodUUID;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
        running: "running";
    }>;
    createdAt: z.ZodISODateTime;
    finishedAt: z.ZodNullable<z.ZodISODateTime>;
    error: z.ZodNullable<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const toolCallSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    arguments: z.ZodString;
}, z.core.$strip>;
export declare const modelMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    role: z.ZodLiteral<"user">;
    content: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    role: z.ZodLiteral<"assistant">;
    content: z.ZodNullable<z.ZodString>;
    toolCalls: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    role: z.ZodLiteral<"tool">;
    toolCallId: z.ZodString;
    content: z.ZodString;
}, z.core.$strip>], "role">;
export declare const messageContentSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"model">;
    message: z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        content: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        content: z.ZodNullable<z.ZodString>;
        toolCalls: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        role: z.ZodLiteral<"tool">;
        toolCallId: z.ZodString;
        content: z.ZodString;
    }, z.core.$strip>], "role">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"chart">;
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
    kind: z.ZodLiteral<"analysis">;
    analysis: z.ZodObject<{
        narrative: z.ZodString;
        caveats: z.ZodArray<z.ZodString>;
        resultRefs: z.ZodArray<z.ZodUUID>;
        chartIds: z.ZodArray<z.ZodUUID>;
    }, z.core.$strip>;
}, z.core.$strip>], "kind">;
export declare const displayMessageSchema: z.ZodObject<{
    id: z.ZodUUID;
    turnId: z.ZodUUID;
    content: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"model">;
        message: z.ZodDiscriminatedUnion<[z.ZodObject<{
            role: z.ZodLiteral<"user">;
            content: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            role: z.ZodLiteral<"assistant">;
            content: z.ZodNullable<z.ZodString>;
            toolCalls: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            role: z.ZodLiteral<"tool">;
            toolCallId: z.ZodString;
            content: z.ZodString;
        }, z.core.$strip>], "role">;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"chart">;
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
        kind: z.ZodLiteral<"analysis">;
        analysis: z.ZodObject<{
            narrative: z.ZodString;
            caveats: z.ZodArray<z.ZodString>;
            resultRefs: z.ZodArray<z.ZodUUID>;
            chartIds: z.ZodArray<z.ZodUUID>;
        }, z.core.$strip>;
    }, z.core.$strip>], "kind">;
}, z.core.$strip>;
export declare const historySchema: z.ZodObject<{
    session: z.ZodObject<{
        id: z.ZodUUID;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strip>;
    turns: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        clientTurnId: z.ZodUUID;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            running: "running";
        }>;
        createdAt: z.ZodISODateTime;
        finishedAt: z.ZodNullable<z.ZodISODateTime>;
        error: z.ZodNullable<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    messages: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        turnId: z.ZodUUID;
        content: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"model">;
            message: z.ZodDiscriminatedUnion<[z.ZodObject<{
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                role: z.ZodLiteral<"assistant">;
                content: z.ZodNullable<z.ZodString>;
                toolCalls: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>, z.ZodObject<{
                role: z.ZodLiteral<"tool">;
                toolCallId: z.ZodString;
                content: z.ZodString;
            }, z.core.$strip>], "role">;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"chart">;
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
            kind: z.ZodLiteral<"analysis">;
            analysis: z.ZodObject<{
                narrative: z.ZodString;
                caveats: z.ZodArray<z.ZodString>;
                resultRefs: z.ZodArray<z.ZodUUID>;
                chartIds: z.ZodArray<z.ZodUUID>;
            }, z.core.$strip>;
        }, z.core.$strip>], "kind">;
    }, z.core.$strip>>;
}, z.core.$strip>;
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
export type QueryResult = z.infer<typeof queryResultSchema>;
export type ResultData = z.infer<typeof resultDataSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type PublishedChart = z.infer<typeof publishedChartSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type StreamEvent = z.infer<typeof streamEventSchema>;
export type ModelMessage = z.infer<typeof modelMessageSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type MessageContent = z.infer<typeof messageContentSchema>;
export type SessionHistory = z.infer<typeof historySchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type TerminalStatus = z.infer<typeof terminalStatusSchema>;
export declare function readEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent>;
