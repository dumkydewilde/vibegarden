import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScrollArea } from "../scroll-area";

describe("ScrollArea", () => {
  it("keeps Radix's content wrapper from growing to a wide child", () => {
    const { container } = render(
      <ScrollArea>
        <div>Wide content belongs in its own horizontal scroller.</div>
      </ScrollArea>,
    );

    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]',
    );

    expect(viewport).toHaveClass("[&>div]:!block");
  });
});
