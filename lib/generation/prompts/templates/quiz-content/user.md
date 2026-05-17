Title: {{title}}
Description: {{description}}
Test Points: {{keyPoints}}
Question Count: {{questionCount}}, Difficulty: {{difficulty}}, Question Types: {{questionTypes}}

{{#if experiencePresetContext}}
{{experiencePresetContext}}
{{/if}}

## Language Directive

{{languageDirective}}

**Language Requirement**: Questions and options must follow the Language Directive above.

Output JSON array directly (no explanation, no code blocks, no LaTeX):
[{"id":"q1","type":"single","question":"Question text","options":["Option A","Option B","Option C","Option D"],"correctAnswer":"Option A"}]
