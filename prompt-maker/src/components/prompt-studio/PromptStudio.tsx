"use client";

import { Dispatch, useCallback, useMemo, useReducer, useState } from "react";

import { promptTemplates } from "@/data/templates";
import {
  chipSuggestions,
  compilePrompt,
  createBlankVariable,
  createBlankWorkflowStage,
  createDefaultPromptState,
  generateAssistantInsights,
} from "@/lib/prompt-utils";
import type {
  PromptArrayKey,
  PromptState,
  WorkflowStage,
  PromptVariable,
} from "@/lib/prompt-types";

import styles from "./PromptStudio.module.css";

type PromptAction =
  | { type: "update"; key: keyof PromptState; value: string }
  | { type: "addChip"; key: PromptArrayKey; value: string }
  | { type: "removeChip"; key: PromptArrayKey; value: string }
  | { type: "setChips"; key: PromptArrayKey; value: string[] }
  | { type: "hydrate"; payload: PromptState }
  | { type: "addVariable" }
  | { type: "removeVariable"; id: string }
  | {
      type: "updateVariable";
      id: string;
      field: keyof PromptVariable;
      value: string;
    }
  | { type: "addWorkflow" }
  | { type: "removeWorkflow"; id: string }
  | {
      type: "updateWorkflow";
      id: string;
      field: keyof WorkflowStage;
      value: string;
    };

const reducer = (state: PromptState, action: PromptAction): PromptState => {
  switch (action.type) {
    case "update":
      return { ...state, [action.key]: action.value };
    case "addChip": {
      const existing = state[action.key];
      if (existing.includes(action.value)) {
        return state;
      }
      return { ...state, [action.key]: [...existing, action.value] };
    }
    case "removeChip":
      return {
        ...state,
        [action.key]: state[action.key].filter((item) => item !== action.value),
      };
    case "setChips":
      return { ...state, [action.key]: [...action.value] };
    case "addVariable":
      return { ...state, variables: [...state.variables, createBlankVariable()] };
    case "removeVariable":
      return {
        ...state,
        variables: state.variables.filter((variable) => variable.id !== action.id),
      };
    case "updateVariable":
      return {
        ...state,
        variables: state.variables.map((variable) =>
          variable.id === action.id
            ? { ...variable, [action.field]: action.value }
            : variable,
        ),
      };
    case "addWorkflow":
      return { ...state, workflow: [...state.workflow, createBlankWorkflowStage()] };
    case "removeWorkflow":
      return {
        ...state,
        workflow: state.workflow.filter((stage) => stage.id !== action.id),
      };
    case "updateWorkflow":
      return {
        ...state,
        workflow: state.workflow.map((stage) =>
          stage.id === action.id ? { ...stage, [action.field]: action.value } : stage,
        ),
      };
    case "hydrate":
      return { ...action.payload };
    default:
      return state;
  }
};

const textSections: Array<{
  id: keyof PromptState;
  title: string;
  placeholder: string;
  helper: string;
  rows?: number;
}> = [
  {
    id: "projectTitle",
    title: "Project Codename",
    placeholder: "e.g. Apollo command console",
    helper: "Optional naming to make the prompt memorable.",
    rows: 1,
  },
  {
    id: "coreObjective",
    title: "Core Objective",
    placeholder:
      "What must the model accomplish? Include problem statement and desired transformation.",
    helper:
      "Give context, stakes, and boundaries. The model should know what success looks like.",
    rows: 4,
  },
  {
    id: "targetAudience",
    title: "Target Audience / Persona",
    placeholder:
      "Who is this prompt ultimately serving? Describe persona, expertise, motivations, anxieties.",
    helper:
      "Helps the model tailor tone, reading level, and references.",
    rows: 3,
  },
  {
    id: "backgroundContext",
    title: "Background Context",
    placeholder:
      "Operational context, systems involved, known constraints, domain specifics, or prior work.",
    helper: "Provide only verified facts. Flag assumptions inline.",
    rows: 4,
  },
  {
    id: "requiredInputs",
    title: "Required Inputs",
    placeholder:
      "What information will the end user provide? List any files, data points, or parameters expected.",
    helper: "Make it explicit so the model can validate presence of required inputs.",
    rows: 3,
  },
  {
    id: "desiredOutput",
    title: "Desired Deliverable",
    placeholder:
      "Describe the final artifact. Mention structure, length, formatting, tables, or decision frameworks.",
    helper: "Pair structure with rationale. Models love specificity.",
    rows: 4,
  },
  {
    id: "successCriteria",
    title: "Success Criteria",
    placeholder:
      "Define what good looks like. Include acceptance tests, quality bars, or evaluation checklist.",
    helper: "This powers automated QA and self-evaluation.",
    rows: 3,
  },
  {
    id: "guardrails",
    title: "Guardrails & Refusal Policy",
    placeholder:
      "Non-negotiables, refusal conditions, compliance rules, safety mitigations, or biases to avoid.",
    helper: "Explicit guardrails drastically reduce hallucinations and policy drift.",
    rows: 3,
  },
  {
    id: "creativeAngles",
    title: "Creative Directions",
    placeholder:
      "Any inspiration sources, brand anchors, emotional tones, or contrary takes to explore.",
    helper: "Encourage the model to produce divergent options.",
    rows: 3,
  },
  {
    id: "referenceMaterial",
    title: "Reference Material",
    placeholder:
      "Paste links, excerpts, or knowledge graph nodes the model should ground to. Clarify why each matters.",
    helper: "Grounding references reduces hallucinations and lifts specificity.",
    rows: 3,
  },
  {
    id: "evaluationStrategy",
    title: "Self-Evaluation Strategy",
    placeholder:
      "How should the model critique itself before finalizing? Provide scoring rubric or checklist.",
    helper: "Tell the model to find its own mistakes before handing off.",
    rows: 3,
  },
  {
    id: "modelPreferences",
    title: "Model / Tooling Preferences",
    placeholder:
      "Optional: specify model family, required tools, retrieval steps, or latency constraints.",
    helper: "Useful when orchestrating across multiple systems.",
    rows: 2,
  },
  {
    id: "callToAction",
    title: "Respond With",
    placeholder:
      "Explicit instructions for the assistant's final answer. e.g. Provide JSON schema, bullet summary, action plan.",
    helper: "Makes downstream automation simpler.",
    rows: 2,
  },
];

const chipGroups: Array<{
  id: PromptArrayKey;
  title: string;
  emptyLabel: string;
  helper: string;
}> = [
  {
    id: "toneTraits",
    title: "Tone DNA",
    emptyLabel: "Add tone traits",
    helper: "Select the emotional stance and voice the model should adopt.",
  },
  {
    id: "styleGuidelines",
    title: "Style Rules",
    emptyLabel: "Add stylistic guidance",
    helper: "Structure, pacing, and formatting requirements.",
  },
  {
    id: "constraints",
    title: "Operational Constraints",
    emptyLabel: "Add non-negotiables",
    helper: "Boundary conditions that keep the model on-rails.",
  },
  {
    id: "keywords",
    title: "Linguistic Anchors",
    emptyLabel: "Add must-use phrases",
    helper: "Terms, jargon, or frameworks to incorporate.",
  },
];

const TemplateLibrary = ({
  onLoad,
  activeTemplateId,
}: {
  onLoad: (id: string) => void;
  activeTemplateId?: string;
}) => (
  <div className={styles.templateLibrary}>
    <header className={styles.templateHeader}>
      <h2>Template Library</h2>
      <p>
        Jump-start with pre-built prompt archetypes. Loading a template replaces current inputs—remember to save variations you care about.
      </p>
    </header>
    <div className={styles.templateList}>
      {promptTemplates.map((template) => (
        <button
          key={template.id}
          type="button"
          className={
            template.id === activeTemplateId
              ? `${styles.templateCard} ${styles.templateCardActive}`
              : styles.templateCard
          }
          onClick={() => onLoad(template.id)}
        >
          <div className={styles.templateMeta}>
            <span className={styles.templateCategory}>{template.category}</span>
            <h3>{template.title}</h3>
            <p>{template.subtitle}</p>
          </div>
          <div className={styles.templateTags}>
            {template.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </button>
      ))}
    </div>
  </div>
);

const ChipInput = ({
  values,
  suggestions,
  onAdd,
  onRemove,
  label,
  helper,
}: {
  values: string[];
  suggestions: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  label: string;
  helper: string;
}) => {
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setDraft("");
  };

  return (
    <div className={styles.chipInput}>
      <div className={styles.sectionHeader}>
        <h3>{label}</h3>
        <p>{helper}</p>
      </div>
      <div className={styles.chipEditor}>
        <div className={styles.chipList}>
          {values.map((value) => (
            <span key={value} className={styles.chip}>
              {value}
              <button type="button" onClick={() => onRemove(value)} aria-label={`Remove ${value}`}>
                ×
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Type and press enter"
          />
        </div>
        <button type="button" className={styles.addChipButton} onClick={handleAdd}>
          Add
        </button>
      </div>
      <div className={styles.chipSuggestions}>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onAdd(suggestion)}
            className={styles.suggestionChip}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
};

const WorkflowEditor = ({
  stages,
  dispatch,
}: {
  stages: WorkflowStage[];
  dispatch: Dispatch<PromptAction>;
}) => (
  <div className={styles.workflowCard}>
    <div className={styles.sectionHeader}>
      <h3>Agent Workflow</h3>
      <p>
        Break the task into deliberate stages so the model reasons step-by-step instead of jumping straight to an answer.
      </p>
    </div>
    <div className={styles.workflowList}>
      {stages.map((stage, index) => (
        <div key={stage.id} className={styles.workflowStage}>
          <header>
            <span className={styles.workflowIndex}>{index + 1}</span>
            <input
              value={stage.title}
              onChange={(event) =>
                dispatch({
                  type: "updateWorkflow",
                  id: stage.id,
                  field: "title",
                  value: event.target.value,
                })
              }
              placeholder="Stage title"
            />
            {stages.length > 1 && (
              <button
                type="button"
                onClick={() => dispatch({ type: "removeWorkflow", id: stage.id })}
                aria-label="Remove workflow stage"
              >
                ×
              </button>
            )}
          </header>
          <label>
            Instruction
            <textarea
              value={stage.instruction}
              rows={3}
              onChange={(event) =>
                dispatch({
                  type: "updateWorkflow",
                  id: stage.id,
                  field: "instruction",
                  value: event.target.value,
                })
              }
            />
          </label>
          <label>
            Expected Output
            <textarea
              value={stage.expectedOutput}
              rows={2}
              onChange={(event) =>
                dispatch({
                  type: "updateWorkflow",
                  id: stage.id,
                  field: "expectedOutput",
                  value: event.target.value,
                })
              }
            />
          </label>
        </div>
      ))}
    </div>
    <button type="button" className={styles.addRowButton} onClick={() => dispatch({ type: "addWorkflow" })}>
      + Add Workflow Stage
    </button>
  </div>
);

const VariablesEditor = ({
  variables,
  dispatch,
}: {
  variables: PromptVariable[];
  dispatch: Dispatch<PromptAction>;
}) => (
  <div className={styles.variablesCard}>
    <div className={styles.sectionHeader}>
      <h3>Reusable Variables</h3>
      <p>
        Parameterize your prompt so teams can drop in new context without rewriting the entire instruction.
      </p>
    </div>
    <div className={styles.variableList}>
      {variables.map((variable) => (
        <div key={variable.id} className={styles.variableItem}>
          <div className={styles.variableHeader}>
            <input
              value={variable.name}
              onChange={(event) =>
                dispatch({
                  type: "updateVariable",
                  id: variable.id,
                  field: "name",
                  value: event.target.value.replace(/\s+/g, "_").toUpperCase(),
                })
              }
              placeholder="VARIABLE_NAME"
            />
            {variables.length > 1 && (
              <button
                type="button"
                onClick={() => dispatch({ type: "removeVariable", id: variable.id })}
                aria-label="Remove variable"
              >
                ×
              </button>
            )}
          </div>
          <textarea
            value={variable.description}
            rows={2}
            placeholder="Describe what this variable represents and when to use it."
            onChange={(event) =>
              dispatch({
                type: "updateVariable",
                id: variable.id,
                field: "description",
                value: event.target.value,
              })
            }
          />
          <textarea
            value={variable.example ?? ""}
            rows={2}
            placeholder="Optional: provide an example value."
            onChange={(event) =>
              dispatch({
                type: "updateVariable",
                id: variable.id,
                field: "example",
                value: event.target.value,
              })
            }
          />
        </div>
      ))}
    </div>
    <button type="button" className={styles.addRowButton} onClick={() => dispatch({ type: "addVariable" })}>
      + Add Variable
    </button>
  </div>
);

type RefineResponse = {
  refinedPrompt?: string;
  analysis?: string;
  error?: string;
};

export const PromptStudio = () => {
  const [state, dispatch] = useReducer(reducer, undefined, createDefaultPromptState);
  const [activeTemplate, setActiveTemplate] = useState<string | undefined>(undefined);
  const [clipboardStatus, setClipboardStatus] = useState<"idle" | "copied">("idle");
  const [refineConfig, setRefineConfig] = useState({
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.4,
    instructions:
      "Critique this prompt then rewrite it for clarity, guardrails, and evaluation. Return markdown with sections: Critique, Upgrades, Final Prompt.",
    apiKey: "",
  });
  const [isRefining, setIsRefining] = useState(false);
  const [refineOutput, setRefineOutput] = useState<RefineResponse | undefined>(undefined);
  const [refineError, setRefineError] = useState<string | undefined>(undefined);

  const assistant = useMemo(() => generateAssistantInsights(state), [state]);
  const compiledPrompt = useMemo(() => compilePrompt(state), [state]);

  const handleLoadTemplate = useCallback(
    (id: string) => {
      const template = promptTemplates.find((entry) => entry.id === id);
      if (!template) return;

      const base = createDefaultPromptState();
      const merged: PromptState = {
        ...base,
        ...template.sections,
        toneTraits: template.sections.toneTraits ?? base.toneTraits,
        styleGuidelines: template.sections.styleGuidelines ?? base.styleGuidelines,
        constraints: template.sections.constraints ?? base.constraints,
        keywords: template.sections.keywords ?? base.keywords,
        workflow: template.sections.workflow ?? base.workflow,
        variables: template.sections.variables ?? base.variables,
      };

      dispatch({ type: "hydrate", payload: merged });
      setActiveTemplate(id);
    },
    [dispatch],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(compiledPrompt);
      setClipboardStatus("copied");
      setTimeout(() => setClipboardStatus("idle"), 1800);
    } catch (error) {
      console.error("Clipboard copy failed", error);
    }
  }, [compiledPrompt]);

  const handleRefine = useCallback(async () => {
    setIsRefining(true);
    setRefineError(undefined);
    setRefineOutput(undefined);

    try {
      const response = await fetch("/api/refine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: compiledPrompt,
          instructions: refineConfig.instructions,
          model: refineConfig.model,
          temperature: refineConfig.temperature,
          provider: refineConfig.provider,
          apiKey: refineConfig.apiKey,
        }),
      });

      const data: RefineResponse = await response.json();

      if (!response.ok) {
        setRefineError(data.error ?? "Unable to refine prompt. Check API key and provider.");
      } else {
        setRefineOutput(data);
      }
    } catch (error) {
      setRefineError("Network error while refining prompt.");
      console.error(error);
    } finally {
      setIsRefining(false);
    }
  }, [compiledPrompt, refineConfig]);

  return (
    <div className={styles.shell}>
      <TemplateLibrary onLoad={handleLoadTemplate} activeTemplateId={activeTemplate} />

      <section className={styles.builderPanel}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Prompt Maker AI</h1>
            <p>
              Engineer elite prompts with deliberate structure, reusable variables, and automated quality checks.
            </p>
          </div>
          <div className={styles.builderActions}>
            <button type="button" onClick={() => dispatch({ type: "hydrate", payload: createDefaultPromptState() })}>
              Reset workspace
            </button>
            <button type="button" onClick={handleCopy} className={styles.primaryButton}>
              {clipboardStatus === "copied" ? "Copied!" : "Copy prompt"}
            </button>
          </div>
        </header>

        <div className={styles.sectionsGrid}>
          {textSections.map((section) => (
            <label key={section.id} className={styles.fieldCard}>
              <div className={styles.sectionHeader}>
                <h3>{section.title}</h3>
                <p>{section.helper}</p>
              </div>
              {section.rows && section.rows <= 1 ? (
                <input
                  value={state[section.id] as string}
                  placeholder={section.placeholder}
                  onChange={(event) =>
                    dispatch({ type: "update", key: section.id, value: event.target.value })
                  }
                />
              ) : (
                <textarea
                  value={state[section.id] as string}
                  rows={section.rows ?? 3}
                  placeholder={section.placeholder}
                  onChange={(event) =>
                    dispatch({ type: "update", key: section.id, value: event.target.value })
                  }
                />
              )}
            </label>
          ))}
        </div>

        <div className={styles.chipsGrid}>
          {chipGroups.map((group) => (
            <ChipInput
              key={group.id}
              values={state[group.id] as unknown as string[]}
              suggestions={chipSuggestions[group.id]}
              onAdd={(value) => dispatch({ type: "addChip", key: group.id, value })}
              onRemove={(value) => dispatch({ type: "removeChip", key: group.id, value })}
              label={group.title}
              helper={group.helper}
            />
          ))}
        </div>

        <WorkflowEditor stages={state.workflow} dispatch={dispatch} />
        <VariablesEditor variables={state.variables} dispatch={dispatch} />
      </section>

      <aside className={styles.assistantPanel}>
        <section className={styles.evaluationCard}>
          <header>
            <h2>Quality Radar</h2>
            <span className={styles.scoreBadge}>{assistant.evaluation.totalScore}</span>
          </header>
          <p className={styles.evaluationSummary}>{assistant.evaluation.summary}</p>
          <ul className={styles.evaluationBreakdown}>
            {assistant.evaluation.breakdown.map((item) => (
              <li key={item.title}>
                <span>{item.title}</span>
                <span>{item.score}</span>
              </li>
            ))}
          </ul>
          {assistant.evaluation.missingSections.length > 0 && (
            <div className={styles.missingSections}>
              <strong>Fill these gaps:</strong>
              <ul>
                {assistant.evaluation.missingSections.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className={styles.insightsCard}>
          <header>
            <h2>Assistant Debrief</h2>
          </header>
          <div className={styles.insightsLists}>
            <div>
              <h3>High-impact upgrades</h3>
              <ul>
                {assistant.impactTips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Quick wins</h3>
              <ul>
                {assistant.quickWins.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={styles.promptPreview}>
          <header>
            <h2>Prompt Preview</h2>
            <button type="button" onClick={handleCopy}>
              {clipboardStatus === "copied" ? "Copied" : "Copy"}
            </button>
          </header>
          <pre className={styles.previewBody}>{compiledPrompt}</pre>
        </section>

        <section className={styles.refineCard}>
          <header>
            <h2>LLM Refinement</h2>
          </header>
          <label className={styles.inlineLabel}>
            Provider
            <select
              value={refineConfig.provider}
              onChange={(event) =>
                setRefineConfig((prev) => ({ ...prev, provider: event.target.value }))
              }
            >
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
          <label className={styles.inlineLabel}>
            Model
            <input
              value={refineConfig.model}
              onChange={(event) =>
                setRefineConfig((prev) => ({ ...prev, model: event.target.value }))
              }
            />
          </label>
          <label className={styles.inlineLabel}>
            Temperature
            <input
              type="number"
              step="0.1"
              min="0"
              max="1.5"
              value={refineConfig.temperature}
              onChange={(event) =>
                setRefineConfig((prev) => ({
                  ...prev,
                  temperature: Number.parseFloat(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label className={styles.inlineLabel}>
            API Key
            <input
              type="password"
              value={refineConfig.apiKey}
              onChange={(event) =>
                setRefineConfig((prev) => ({ ...prev, apiKey: event.target.value }))
              }
              placeholder="Optional – paste when ready"
            />
          </label>
          <label className={styles.inlineLabel}>
            Refinement Instructions
            <textarea
              rows={4}
              value={refineConfig.instructions}
              onChange={(event) =>
                setRefineConfig((prev) => ({ ...prev, instructions: event.target.value }))
              }
            />
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={isRefining || !refineConfig.apiKey}
            onClick={handleRefine}
          >
            {isRefining ? "Refining..." : "Refine with AI"}
          </button>
          {refineError && <p className={styles.errorText}>{refineError}</p>}
          {refineOutput?.analysis && (
            <div className={styles.refineResult}>
              <h3>Model Analysis</h3>
              <pre>{refineOutput.analysis}</pre>
            </div>
          )}
          {refineOutput?.refinedPrompt && (
            <div className={styles.refineResult}>
              <h3>Refined Prompt</h3>
              <pre>{refineOutput.refinedPrompt}</pre>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
};

export default PromptStudio;
