import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminConversation, { loader } from "../admin.conversations.$id";
import { requireClubPermission } from "~/lib/club-permissions";
import { requireClubContext } from "~/lib/clubs.server";
import { getAdminThread } from "~/lib/threads.server";

vi.mock("~/lib/club-permissions", () => ({ requireClubPermission: vi.fn() }));
vi.mock("~/lib/clubs.server", () => ({ requireClubContext: vi.fn() }));
vi.mock("~/lib/threads.server", () => ({
  getAdminThread: vi.fn(),
  parseContext: (raw: string | null) =>
    raw
      ? [
          {
            kind: "paragraph" as const,
            label: "Workshop notes",
            content: "People need more examples of database choices.",
          },
        ]
      : undefined,
}));

const mockedRequireClubPermission = vi.mocked(requireClubPermission);
const mockedRequireClubContext = vi.mocked(requireClubContext);
const mockedGetAdminThread = vi.mocked(getAdminThread);

const transcript = {
  title: "Build a reading tracker",
  participant: { name: "Ada Lovelace", email: "ada@example.com" },
  messages: [
    {
      id: "message-1",
      role: "user" as const,
      text: "How should I store the books?",
      context: [
        {
          kind: "paragraph" as const,
          label: "Workshop notes",
          content: "People need more examples of database choices.",
        },
      ],
    },
    {
      id: "message-2",
      role: "gardener" as const,
      text: "Start with a small table of books.",
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mockedRequireClubContext.mockResolvedValue({ club: { id: "club-wotf" } } as never);
});

describe("Admin conversation loader", () => {
  const args = (id = "thread-1") =>
    ({
      request: new Request("http://example.com/clubs/wotf/admin/conversations/" + id),
      params: { id, clubSlug: "wotf" },
      context: { get: () => ({ env: {} }) },
    }) as never;

  it("authorizes before loading a participant transcript", async () => {
    mockedGetAdminThread.mockResolvedValue({
      thread: { title: "Build a reading tracker" },
      participant: transcript.participant,
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "How should I store the books?",
          context: "context",
        },
      ],
    } as never);

    await expect(loader(args())).resolves.toMatchObject({
      title: "Build a reading tracker",
      participant: transcript.participant,
    });
    expect(mockedRequireClubPermission).toHaveBeenCalledWith(expect.anything(), "moderate");
    expect(mockedGetAdminThread).toHaveBeenCalledWith({}, "club-wotf", "thread-1");
  });

  it("does not query a transcript when the requester is not an admin", async () => {
    mockedRequireClubPermission.mockImplementation(() => {
      throw new Response("Not found", { status: 404 });
    });

    await expect(loader(args())).rejects.toMatchObject({ status: 404 });
    expect(mockedGetAdminThread).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing participant transcript", async () => {
    mockedGetAdminThread.mockResolvedValue(null);

    await expect(loader(args("missing"))).rejects.toMatchObject({ status: 404 });
  });
});

describe("Admin conversation transcript", () => {
  it("renders saved messages and context without participant controls", async () => {
    const Stub = createRoutesStub([
      {
        path: "/clubs/:clubSlug/admin/conversations/:id",
        Component: AdminConversation,
        loader: () => transcript,
      },
    ]);
    render(<Stub initialEntries={["/clubs/wotf/admin/conversations/thread-1"]} />);

    expect(
      await screen.findByRole("heading", { name: "Build a reading tracker" }),
    ).toBeInTheDocument();
    expect(screen.getByText("People need more examples of database choices.")).toBeInTheDocument();
    expect(screen.getByText("Start with a small table of books.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute(
      "href",
      "/clubs/wotf/admin",
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByText(/plant as a project/i)).not.toBeInTheDocument();
  });
});
