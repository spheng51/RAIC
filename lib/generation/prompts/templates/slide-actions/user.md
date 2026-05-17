Elements: {{elements}}
Title: {{title}}
Key Points: {{keyPoints}}
Description: {{description}}
{{courseContext}}
{{agents}}
{{userProfile}}

{{#if experiencePresetContext}}
{{experiencePresetContext}}
{{/if}}

## Language Directive

{{languageDirective}}

**Language Requirement**: Generated speech content must follow the Language Directive above.

Output as a JSON array directly (no explanation, no code fences, 5-10 segments):
[{"type":"action","name":"spotlight","params":{"elementId":"text_xxx"}},{"type":"text","content":"Opening speech content"}]
