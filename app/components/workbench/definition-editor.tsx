import {
  BookOpen,
  BrainCircuit,
  Globe2,
  Pencil,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react";
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
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import {
  MAX_SKILLS,
  MAX_TOOLS,
  SKILL_CONTENT_MAX_CHARS,
  TOOL_DESCRIPTION_MAX_CHARS,
  TOOL_NAME_RE,
  type AgentDefinition,
  type AgentSkillDef,
  type AgentToolDef,
} from "~/lib/agents/contracts";
import { toolToYaml } from "~/lib/agents/yaml";

type EditingTool = {
  index: number | null;
  tool: AgentToolDef;
  initialText?: string;
};

type EditingSkill = {
  index: number | null;
  skill: AgentSkillDef;
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

function exampleSkill(definition: AgentDefinition): EditingSkill {
  const names = new Set(
    [...definition.tools, ...definition.skills].map(({ name }) => name),
  );
  let name = "my_skill";
  let suffix = 2;
  while (names.has(name)) {
    name = `my_skill_${suffix}`;
    suffix += 1;
  }
  return {
    index: null,
    skill: {
      name,
      description: "Instructions the agent can load when needed.",
      content: "Describe the method, checks, and expected result here.",
    },
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
  const [editingSkill, setEditingSkill] = useState<EditingSkill | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
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

  function updateEditingSkill(field: keyof AgentSkillDef, value: string) {
    setEditingSkill((current) =>
      current
        ? { ...current, skill: { ...current.skill, [field]: value } }
        : null,
    );
    setSkillError(null);
  }

  function applySkill() {
    if (!editingSkill) return;
    const skill: AgentSkillDef = {
      ...editingSkill.skill,
      name: editingSkill.skill.name.trim(),
      description: editingSkill.skill.description.trim(),
    };
    if (!TOOL_NAME_RE.test(skill.name)) {
      setSkillError(
        "Skill names must use lower-case snake_case and contain 2 to 40 characters.",
      );
      return;
    }
    if (
      !skill.description ||
      skill.description.length > TOOL_DESCRIPTION_MAX_CHARS
    ) {
      setSkillError(
        `Skill descriptions must contain 1 to ${TOOL_DESCRIPTION_MAX_CHARS} characters.`,
      );
      return;
    }
    if (
      !skill.content.trim() ||
      skill.content.length > SKILL_CONTENT_MAX_CHARS
    ) {
      setSkillError(
        `Skill content must contain 1 to ${SKILL_CONTENT_MAX_CHARS.toLocaleString()} characters.`,
      );
      return;
    }
    const duplicate =
      draft.tools.some((candidate) => candidate.name === skill.name) ||
      draft.skills.some(
        (candidate, index) =>
          candidate.name === skill.name && index !== editingSkill.index,
      );
    if (duplicate) {
      setSkillError(`A tool or skill named "${skill.name}" already exists.`);
      return;
    }
    if (editingSkill.index === null && draft.skills.length >= MAX_SKILLS) {
      setSkillError("Remove a skill before adding another one.");
      return;
    }
    setDraft((current) => {
      const skills = [...current.skills];
      if (editingSkill.index === null) skills.push(skill);
      else skills[editingSkill.index] = skill;
      return { ...current, skills };
    });
    setSkillError(null);
    setEditingSkill(null);
  }

  function removeSkill(index: number) {
    setDraft((current) => ({
      ...current,
      skills: current.skills.filter((_, candidate) => candidate !== index),
    }));
    setSkillError(null);
    setEditingSkill((current) => {
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

          <section
            className="space-y-3 border-t pt-5"
            aria-labelledby="agent-skills-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2
                  id="agent-skills-heading"
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <BookOpen className="size-4 text-muted-foreground" />
                  Skills
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Prompt snippets the agent can load with use_skill.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {draft.skills.length} / {MAX_SKILLS}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={draft.skills.length >= MAX_SKILLS}
                  onClick={() => {
                    setSkillError(null);
                    setEditingSkill(exampleSkill(draft));
                  }}
                >
                  <Plus />
                  Add skill
                </Button>
              </div>
            </div>

            {draft.skills.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No skills yet. Add focused instructions the agent can load only
                when they are useful.
              </div>
            ) : (
              <ul className="space-y-2">
                {draft.skills.map((skill, index) => (
                  <li
                    key={`${index}:${skill.name}`}
                    className="flex flex-col gap-3 rounded-lg border bg-background px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <code className="break-all text-sm font-semibold text-foreground">
                        {skill.name}
                      </code>
                      <p className="mt-1 text-sm leading-snug text-muted-foreground">
                        {skill.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1 sm:justify-end">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        aria-label={`Edit ${skill.name}`}
                        onClick={() => {
                          setSkillError(null);
                          setEditingSkill({ index, skill });
                        }}
                      >
                        <Pencil />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        aria-label={`Remove ${skill.name}`}
                        onClick={() => removeSkill(index)}
                      >
                        <Trash2 />
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {editingSkill && (
              <div
                role="group"
                aria-labelledby="skill-editor-heading"
                className="space-y-4 rounded-lg border bg-muted/20 p-4"
              >
                <div>
                  <h3 id="skill-editor-heading" className="text-sm font-medium">
                    {editingSkill.index === null ? "Add skill" : "Edit skill"}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The description appears in the skills index. Content is
                    revealed to the model only after use_skill runs.
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="skill-name" className="text-sm font-medium">
                    Skill name
                  </label>
                  <Input
                    id="skill-name"
                    value={editingSkill.skill.name}
                    maxLength={40}
                    spellCheck={false}
                    onChange={(event) =>
                      updateEditingSkill("name", event.target.value)
                    }
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Lower-case snake_case, unique across tools and skills.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <label
                      htmlFor="skill-description"
                      className="text-sm font-medium"
                    >
                      Skill description
                    </label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {editingSkill.skill.description.length} / {TOOL_DESCRIPTION_MAX_CHARS}
                    </span>
                  </div>
                  <Textarea
                    id="skill-description"
                    rows={2}
                    maxLength={TOOL_DESCRIPTION_MAX_CHARS}
                    value={editingSkill.skill.description}
                    onChange={(event) =>
                      updateEditingSkill("description", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <label
                      htmlFor="skill-content"
                      className="text-sm font-medium"
                    >
                      Skill content
                    </label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {editingSkill.skill.content.length.toLocaleString()} / {SKILL_CONTENT_MAX_CHARS.toLocaleString()}
                    </span>
                  </div>
                  <Textarea
                    id="skill-content"
                    rows={8}
                    maxLength={SKILL_CONTENT_MAX_CHARS}
                    value={editingSkill.skill.content}
                    onChange={(event) =>
                      updateEditingSkill("content", event.target.value)
                    }
                    className="min-h-40 resize-y font-mono text-sm leading-relaxed"
                  />
                </div>
                {skillError && (
                  <p role="alert" className="text-sm text-destructive">
                    {skillError}
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSkillError(null);
                      setEditingSkill(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="button" onClick={applySkill}>
                    Apply skill
                  </Button>
                </div>
              </div>
            )}
            {skillError && !editingSkill && (
              <p role="alert" className="text-sm text-destructive">
                {skillError}
              </p>
            )}
          </section>

          <section
            className="space-y-3 border-t pt-5"
            aria-labelledby="agent-builtins-heading"
          >
            <div>
              <h2
                id="agent-builtins-heading"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <BrainCircuit className="size-4 text-muted-foreground" />
                Built-in tools
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose which browser-held capabilities this saved version can
                call.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label
                htmlFor="builtin-fetch-page"
                className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border bg-background p-3"
              >
                <span className="flex min-w-0 gap-2.5">
                  <Globe2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block text-sm font-medium">Fetch pages</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      Fetch text through the guarded proxy.
                    </span>
                  </span>
                </span>
                <Switch
                  id="builtin-fetch-page"
                  aria-label="Fetch pages"
                  checked={draft.builtins.fetchPage}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      builtins: { ...current.builtins, fetchPage: checked },
                    }))
                  }
                />
              </label>
              <label
                htmlFor="builtin-memory"
                className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border bg-background p-3"
              >
                <span className="flex min-w-0 gap-2.5">
                  <BrainCircuit className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block text-sm font-medium">Memory</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      Remember and recall values in this browser.
                    </span>
                  </span>
                </span>
                <Switch
                  id="builtin-memory"
                  aria-label="Memory"
                  checked={draft.builtins.memory}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      builtins: { ...current.builtins, memory: checked },
                    }))
                  }
                />
              </label>
            </div>
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
