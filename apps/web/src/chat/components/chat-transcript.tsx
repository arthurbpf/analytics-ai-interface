import type { Analysis, Clarification, SessionHistory } from "@analytics/contracts";
import { ActivityList } from "./turn-activity.tsx";
import { ChartView } from "../charts/analysis-chart.tsx";
import { Markdown } from "./chat-markdown.tsx";
import type { ActiveResponse } from "../state/stream-events.ts";

/**
 * Renders a clarification request and its questions.
 *
 * @param props - Component props.
 * @param props.clarification - Clarification to display.
 * @returns The rendered clarification.
 */
function ClarificationView({ clarification }: { clarification: Clarification }) {
  return (
    <div className="space-y-4">
      <Markdown>{clarification.context}</Markdown>
      <ol className="list-decimal space-y-2 pl-5">
        {clarification.questions.map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Renders an analysis narrative with its deduplicated caveats.
 *
 * @param props - Component props.
 * @param props.analysis - Analysis to display.
 * @returns The rendered analysis.
 */
function AnalysisView({ analysis }: { analysis: Analysis }) {
  return (
    <div className="space-y-4">
      <Markdown>{analysis.narrative}</Markdown>
      {analysis.caveats.length > 0 && (
        <div className="border-l-2 pl-4 text-xs leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">Caveats</p>
          <ul className="list-disc pl-4">
            {[...new Set(analysis.caveats)].map((caveat) => (
              <li key={caveat}>
                <Markdown>{caveat}</Markdown>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Renders a user prompt bubble.
 *
 * @param props - Component props.
 * @param props.text - Prompt text to display.
 * @returns The rendered prompt.
 */
function UserPrompt({ text }: { text: string }) {
  return (
    <div className="ml-auto max-w-[90%] border bg-muted px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
      {text}
    </div>
  );
}

/**
 * Renders saved messages and the in-flight response for the selected session.
 *
 * @param props - Component props.
 * @param props.history - Saved history for the selected session, if loaded.
 * @param props.active - In-flight response, if one is streaming.
 * @returns The rendered transcript.
 */
export function Transcript({
  history,
  active,
}: {
  history: SessionHistory | undefined;
  active: ActiveResponse | null;
}) {
  const saved = history?.messages ?? [];
  /**
   * Reports whether the active turn already has a saved message of a kind.
   *
   * @param kind - Message kind to look for in saved history.
   * @returns True when a saved message of that kind belongs to the active turn.
   */
  const hasSaved = (kind: "user" | "analysis" | "clarification") =>
    saved.some((message) => message.turnId === active?.turnId && message.content.kind === kind);
  /**
   * Reports whether a chart is already present in saved history.
   *
   * @param id - Chart id to look for.
   * @returns True when the saved history already contains the chart.
   */
  const savedChart = (id: string) =>
    saved.some((message) => message.content.kind === "chart" && message.content.chart.id === id);
  return (
    <>
      {saved.map((message) => (
        <div key={message.id}>
          {message.content.kind === "user" ? (
            <UserPrompt text={message.content.text} />
          ) : message.content.kind === "chart" ? (
            <ChartView chart={message.content.chart} />
          ) : message.content.kind === "clarification" ? (
            <ClarificationView clarification={message.content.clarification} />
          ) : (
            <AnalysisView analysis={message.content.analysis} />
          )}
        </div>
      ))}
      {active && (
        <div className="space-y-5">
          {!hasSaved("user") && <UserPrompt text={active.text} />}
          {!active.finished && (
            <ActivityList activities={active.activities} progress={active.progress} />
          )}
          {active.charts
            .filter((chart) => !savedChart(chart.id))
            .map((chart) => (
              <ChartView key={chart.id} chart={chart} />
            ))}
          {active.clarification && !hasSaved("clarification") && (
            <ClarificationView clarification={active.clarification} />
          )}
          {active.analysis && !hasSaved("analysis") && <AnalysisView analysis={active.analysis} />}
        </div>
      )}
      {!active &&
        history?.turns
          .filter((turn) => turn.status !== "completed")
          .map((turn) => (
            <output key={turn.id} className="text-xs text-muted-foreground">
              {turn.status === "running"
                ? "Analysis is still running. Checking saved history…"
                : (turn.error?.message ?? `Analysis ${turn.status}. Saved artifacts are retained.`)}
            </output>
          ))}
    </>
  );
}
