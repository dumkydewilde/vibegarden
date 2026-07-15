import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { CommentThread } from "../comment-thread";
import type { CommentView } from "~/lib/comments.server";

const NOW = 1_000_000_000_000;

function renderThread(comments: CommentView[], canModerate = false) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <CommentThread
          targetType="article"
          targetId="what-is-an-agent"
          comments={comments}
          canModerate={canModerate}
          now={NOW}
        />
      ),
      action: () => ({ ok: true }),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

const own: CommentView = {
  id: "c1",
  body: "This clicked for me.",
  createdAt: NOW - 60_000,
  authorName: "Me",
  own: true,
};
const other: CommentView = {
  id: "c2",
  body: "Same, the analogy helped.",
  createdAt: NOW - 3_600_000,
  authorName: "Robin",
  own: false,
};

describe("CommentThread", () => {
  it("shows an empty state and always offers the composer", () => {
    renderThread([]);
    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /your comment/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /post comment/i }),
    ).toBeInTheDocument();
  });

  it("renders comments with author and count", () => {
    renderThread([own, other]);
    expect(screen.getByText("This clicked for me.")).toBeInTheDocument();
    expect(screen.getByText("Same, the analogy helped.")).toBeInTheDocument();
    expect(screen.getByText("Robin")).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("offers delete only on your own comment for a normal user", () => {
    renderThread([own, other]);
    expect(screen.getAllByRole("button", { name: /delete comment/i })).toHaveLength(
      1,
    );
  });

  it("lets an admin delete any comment", () => {
    renderThread([own, other], true);
    expect(screen.getAllByRole("button", { name: /delete comment/i })).toHaveLength(
      2,
    );
  });
});
