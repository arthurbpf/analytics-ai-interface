import { ChartBarIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

/**
 * Renders the empty-state prompt suggestions.
 *
 * @param props - Component props.
 * @param props.onSubmit - Callback that submits a suggested prompt.
 * @returns The rendered empty state.
 */
export function EmptyState({ onSubmit }: { onSubmit: (text: string) => void }) {
  const suggestions = [
    "How did revenue change over November 2020?",
    "Compare purchases by device category.",
  ];
  return (
    <div className="py-16 md:py-24">
      <ChartBarIcon size={32} className="mb-6" />
      <h2 className="text-2xl font-medium tracking-tight">Explore your ecommerce data.</h2>
      <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">
        Ask a question, inspect the charts, and follow up. Each analysis uses the GA4 ecommerce
        sample.
      </p>
      <div className="mt-8 grid gap-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            type="button"
            variant="outline"
            className="h-auto justify-start whitespace-normal py-3 text-left"
            onClick={() => onSubmit(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
}
