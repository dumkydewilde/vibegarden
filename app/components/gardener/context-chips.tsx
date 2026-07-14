import { ContextQuote } from "./context-quote";
import { useGardener } from "./gardener-provider";

/** Pending context, shown above the composer until the next message. */
export function ContextChips() {
  const { contextItems, removeContext } = useGardener();
  if (contextItems.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t px-3 py-2">
      <p className="text-xs text-muted-foreground">
        Along with your next message:
      </p>
      {contextItems.map((item) => (
        <ContextQuote
          key={item.id}
          item={item}
          onRemove={() => removeContext(item.id)}
        />
      ))}
    </div>
  );
}
