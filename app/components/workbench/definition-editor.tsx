import { Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";

import { ToolEditor } from "~/components/workbench/tool-editor";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  MAX_TOOLS,
  type AgentDefinition,
  type AgentToolDef,
} from "~/lib/agents/contracts";
import { toolToYaml } from "~/lib/agents/yaml";

type EditingTool = {
  index: number | null;
  tool: AgentToolDef;
  initialText?: string;
};

function exampleTool(
  tools: AgentToolDef[],
  skills: AgentDefinition["skills"],
): EditingTool {
  const names = new Set([...tools, ...skills].map(({ name }) => name));
  let name = "my_tool";
  let suffix = 2;
  while (names.has(name)) {
    name = `my_tool_${suffix}`;
    suffix += 1;
  }
  const tool: AgentToolDef = {
    name,
    description: "Transforms text for the agent.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    source: [
      "// This code runs in the isolated browser tool runner.",
      'return { text: String(args.text ?? "") };',
    ].join("\n"),
  };
  return {
    index: null,
    tool,
    initialText: [
      "# Tool names use lower-case snake_case.",
      "# Parameters are a JSON Schema object passed to the model.",
      toolToYaml(tool),
    ].join("\n"),
  };
}

export function DefinitionEditor({
  agent,
  definition,
  actionData,
  stagedTool,
  onDefinitionChange,
}: {
  agent: { name: string; description: string };
  definition: AgentDefinition;
  actionData?: { error?: string; saved?: boolean };
  stagedTool?: AgentToolDef | null;
  onDefinitionChange?: (definition: AgentDefinition) => void;
}) {
  const navigation = useNavigation();
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [draft, setDraft] = useState(definition);
  const [editing, setEditing] = useState<EditingTool | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const saving =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "save";
  const submittedDefinition = JSON.stringify(draft);

  useEffect(() => {
    onDefinitionChange?.(draft);
  }, [draft, onDefinitionChange]);

  useEffect(() => {
    if (!stagedTool) return;
    if (draft.skills.some(({ name: skillName }) => skillName === stagedTool.name)) {
      setToolError(`A skill named "${stagedTool.name}" already exists.`);
      return;
    }
    const existing = draft.tools.findIndex(
      ({ name: toolName }) => toolName === stagedTool.name,
    );
    if (existing < 0 && draft.tools.length >= MAX_TOOLS) {
      setToolError(`Remove a tool before adding "${stagedTool.name}".`);
      return;
    }
    const tools = [...draft.tools];
    if (existing >= 0) tools[existing] = stagedTool;
    else tools.push(stagedTool);
    setDraft({ ...draft, tools });
    setEditing(null);
    setToolError(null);
  }, [stagedTool]);

  function applyTool(tool: AgentToolDef) {
    if (!editing) return;
    const duplicate =
      draft.tools.some(
        (candidate, index) =>
          candidate.name === tool.name && index !== editing.index,
      ) || draft.skills.some((candidate) => candidate.name === tool.name);
    if (duplicate) {
      setToolError(`A tool or skill named "${tool.name}" already exists.`);
      return;
    }
    setDraft((current) => {
      const tools = [...current.tools];
      if (editing.index === null) tools.push(tool);
      else tools[editing.index] = tool;
      return { ...current, tools };
    });
    setToolError(null);
    setEditing(null);
  }

  function removeTool(index: number) {
    setDraft((current) => ({
      ...current,
      tools: current.tools.filter((_, candidate) => candidate !== index),
    }));
    setToolError(null);
    setEditing((current) => {
      if (!current) return null;
      if (current.index === index) return null;
      if (current.index !== null && current.index > index) {
        return { ...current, index: current.index - 1 };
      }
      return current;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-xl font-normal">
          Instructions
        </CardTitle>
        <CardDescription>
          Give the agent a purpose, voice, and clear boundaries.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post" className="space-y-6">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="definition" value={submittedDefinition} />
          <div className="space-y-2">
            <label htmlFor="agent-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="agent-name"
              name="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="agent-description" className="text-sm font-medium">
              Description
            </label>
            <Textarea
              id="agent-description"
              name="description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="system-prompt" className="text-sm font-medium">
                System prompt
              </label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {draft.systemPrompt.length.toLocaleString()} / 8,000
              </span>
            </div>
            <Textarea
              id="system-prompt"
              rows={14}
              maxLength={8_000}
              value={draft.systemPrompt}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  systemPrompt: event.target.value,
                }))
              }
              placeholder="You are a thoughtful museum guide. Explain each artwork in plain language, ask one curious follow-up question, and never invent facts."
              className="min-h-72 resize-y font-mono text-sm leading-relaxed"
            />
          </div>

          <section
            className="space-y-3 border-t pt-5"
            aria-labelledby="agent-tools-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2
                  id="agent-tools-heading"
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <Wrench className="size-4 text-muted-foreground" />
                  Tools
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  JavaScript tools run in an isolated browser sandbox.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {draft.tools.length} / {MAX_TOOLS}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={draft.tools.length >= MAX_TOOLS}
                  onClick={() => {
                    setToolError(null);
                    setEditing(exampleTool(draft.tools, draft.skills));
                  }}
                >
                  <Plus />
                  Add tool
                </Button>
              </div>
            </div>

            {draft.tools.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No custom tools yet. Add one to give this agent a
                browser-sandboxed capability.
              </div>
            ) : (
              <ul className="space-y-2">
                {draft.tools.map((tool, index) => (
                  <li
                    key={`${index}:${tool.name}`}
                    className="flex flex-col gap-3 rounded-lg border bg-background px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <code className="break-all text-sm font-semibold text-foreground">
                        {tool.name}
                      </code>
                      <p className="mt-1 text-sm leading-snug text-muted-foreground">
                        {tool.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1 sm:justify-end">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        aria-label={`Edit ${tool.name}`}
                        onClick={() => {
                          setToolError(null);
                          setEditing({ index, tool });
                        }}
                      >
                        <Pencil />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        aria-label={`Remove ${tool.name}`}
                        onClick={() => removeTool(index)}
                      >
                        <Trash2 />
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {editing && (
              <ToolEditor
                key={`${editing.index ?? "new"}:${editing.tool.name}`}
                tool={editing.tool}
                initialText={editing.initialText}
                onChange={applyTool}
                onCancel={() => {
                  setToolError(null);
                  setEditing(null);
                }}
              />
            )}
            {toolError && (
              <p role="alert" className="text-sm text-destructive">
                {toolError}
              </p>
            )}
          </section>

          {actionData?.error && (
            <p role="alert" className="text-sm text-destructive">
              {actionData.error}
            </p>
          )}
          {actionData?.saved && (
            <p role="status" className="text-sm text-muted-foreground">
              Saved as a new version.
            </p>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save new version"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
