import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

const baseEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--color-foreground)",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    height: "100%",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "8px 10px",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-foreground)",
  },
  ".cm-editor": {
    backgroundColor: "transparent",
    height: "100%",
    outline: "none",
  },
  ".cm-editor.cm-focused": {
    outline: "none",
  },
  ".cm-line": {
    padding: 0,
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    overflow: "auto",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-primary) 22%, transparent)",
  },
});

const hiddenGutterTheme = EditorView.theme({
  ".cm-gutters": {
    display: "none",
  },
});

const lineNumberTheme = EditorView.theme({
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--color-muted-foreground)",
    paddingInlineStart: "2px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "2.75rem",
    paddingInline: "8px 6px",
  },
});

const plainTextSetup = [
  highlightSpecialChars(),
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
];

export function CodeEditorSurface({
  ariaLabel,
  className,
  lineWrapping = false,
  onChange,
  readOnly = false,
  showLineNumbers = false,
  value,
}: {
  ariaLabel: string;
  className?: string;
  lineWrapping?: boolean;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  showLineNumbers?: boolean;
  value: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initialValueRef = useRef(value);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const syncingRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = containerRef.current;

    if (!parent) {
      return;
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          plainTextSetup,
          baseEditorTheme,
          showLineNumbers ? [lineNumbers(), lineNumberTheme] : [hiddenGutterTheme],
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            autocapitalize: "none",
            autocorrect: "off",
            role: "textbox",
            spellcheck: "false",
          }),
          ...(lineWrapping ? [EditorView.lineWrapping] : []),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || syncingRef.current) {
              return;
            }
            onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [ariaLabel, lineWrapping, readOnly, showLineNumbers]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }

    syncingRef.current = true;
    const selectionHead = view.state.selection.main.head;
    view.dispatch({
      changes: { from: 0, insert: value, to: currentValue.length },
      selection: EditorSelection.cursor(Math.min(selectionHead, value.length)),
    });
    syncingRef.current = false;
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "h-full min-h-0 bg-background text-sm leading-6 text-foreground [&_.cm-content]:[scrollbar-gutter:stable_both-edges]",
        className,
      )}
    />
  );
}
