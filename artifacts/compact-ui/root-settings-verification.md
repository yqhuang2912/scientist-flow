# Root-directory settings verification

- Current full path appears below “Root directory” in smaller muted type.
- Hint spans the content pane; the duplicate path row and large warning box
  have been removed. The action button is centered.
- Chrome: a temporary empty directory enabled “Change directory”; its
  confirmation was cancelled. A temporary nonempty directory showed only
  “Directory is not empty.” and disabled the action.
- The real workspace config SHA-256 was identical before and after the browser
  checks; the temporary empty directory remained empty. No migration ran.
- Seven Node tests passed: shared required-path schema, empty destination,
  ordinary/hidden file and empty-child-directory rejection, content changing
  after inspection, and invalid filesystem targets. All fixtures were isolated.
- Scoped ESLint and diff whitespace checks passed. Typecheck still reports
  the 19 existing errors in components/ai-elements, with no errors in the
  changed workspace files. A full build and real migration were not run for
  this focused settings change.
- Screenshot: root-settings.png.
