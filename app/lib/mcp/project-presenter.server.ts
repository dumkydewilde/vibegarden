import { BODY_MAX_CHARS } from "~/lib/mcp/contracts";
import { parseContext } from "~/lib/threads.server";
import { stripToolNotes } from "@vibegarden/agent-web";

type ProjectInput = {
  id: string;
  title: string;
  oneLiner: string | null;
  status: string;
  moduleList: string[];
  updatedAt: number;
};

type ConversationInput = {
  id: string;
  title: string | null;
  updatedAt: number;
  messageCount: number;
};

type ConversationMessageInput = {
  role: string;
  content: string;
  context: string | null;
  createdAt: number;
};

type ConversationPageInput = {
  thread: Omit<ConversationInput, "messageCount"> & { createdAt: number };
  messages: ConversationMessageInput[];
  nextCursor?: string;
};

type ProjectConversations = {
  primary?: ConversationInput | null;
  linked?: ConversationInput[];
};

function canonicalUrl(appOrigin: string, path: string): string {
  return new URL(path, appOrigin).toString();
}

function conversationUrl(appOrigin: string, id: string): string {
  return canonicalUrl(appOrigin, `/garden/conversations/${encodeURIComponent(id)}`);
}

/** Maps a private project row to the fixed public MCP shape. */
export function presentProject(
  appOrigin: string,
  project: ProjectInput,
  conversations?: ProjectConversations,
) {
  const result = {
    id: project.id,
    title: project.title,
    one_liner: project.oneLiner,
    status: project.status,
    building_blocks: project.moduleList,
    updated_at: project.updatedAt,
    url: canonicalUrl(
      appOrigin,
      `/garden/projects/${encodeURIComponent(project.id)}`,
    ),
  };

  if (!conversations) return result;

  return {
    ...result,
    conversations: [
      ...(conversations.primary
        ? [presentConversationSummary(appOrigin, conversations.primary)]
        : []),
      ...(conversations.linked ?? []).map((thread) =>
        presentConversationSummary(appOrigin, thread),
      ),
    ],
  };
}

/** Maps a private thread summary to the fixed public MCP shape. */
export function presentConversationSummary(
  appOrigin: string,
  conversation: ConversationInput,
) {
  return {
    id: conversation.id,
    title: conversation.title,
    updated_at: conversation.updatedAt,
    message_count: conversation.messageCount,
    url: conversationUrl(appOrigin, conversation.id),
  };
}

function presentMessage(message: ConversationMessageInput) {
  const context = (parseContext(message.context) ?? [])
    .filter((item): item is { label: string } => typeof item?.label === "string")
    .map((item) => ({
      label: item.label.slice(0, 120),
      source: "user-authored context" as const,
    }));

  return {
    role: message.role,
    content: stripToolNotes(message.content).slice(0, BODY_MAX_CHARS),
    context,
    created_at: message.createdAt,
  };
}

/** Maps an owned thread page to public conversation and message fields only. */
export function presentConversationPage(
  appOrigin: string,
  page: ConversationPageInput,
) {
  const result = {
    conversation: {
      id: page.thread.id,
      title: page.thread.title,
      updated_at: page.thread.updatedAt,
      url: conversationUrl(appOrigin, page.thread.id),
    },
    messages: page.messages.map(presentMessage),
  };
  return page.nextCursor ? { ...result, next_cursor: page.nextCursor } : result;
}
