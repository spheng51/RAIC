Please generate scene outlines based on the following course requirements.

---

## User Requirements

{{requirement}}

---

{{userProfile}}

## Course Language

**Target locale code**: {{language}}

Return a clear `languageDirective` that downstream scene, quiz, and narration prompts can reuse. It must require the generated classroom content to match this locale.

---

## Reference Materials

### PDF Content Summary

{{pdfContent}}

### Available Images

{{availableImages}}

### Web Search Results

{{researchContext}}

{{teacherContext}}

---

## Output Requirements

Please automatically infer the following from user requirements:

- Course topic and core content
- Target audience and difficulty level
- Course duration (default 15-30 minutes if not specified)
- Teaching style (formal/casual/interactive/academic)
- Visual style (minimal/colorful/professional/playful)

Then output a JSON object with `languageDirective` and `outlines`. Each scene in `outlines` must include:

```json
{
  "languageDirective": "All classroom content, slide text, quiz text, UI labels, and narration must be written in English.",
  "outlines": [
    {
      "id": "scene_1",
      "type": "slide" or "quiz" or "interactive",
      "title": "Scene Title",
      "description": "Teaching purpose description",
      "keyPoints": ["Point 1", "Point 2", "Point 3"],
      "order": 1
    }
  ]
}
```

### Special Notes

1. **quiz scenes must include quizConfig**:
   ```json
   "quizConfig": {
     "questionCount": 2,
     "difficulty": "easy" | "medium" | "hard",
     "questionTypes": ["single", "multiple"]
   }
   ```
{{#if hasSourceImages}}
2. **If source images are available**, add `suggestedImageIds` to relevant slide scenes
{{/if}}
3. **Interactive scenes**: If a concept benefits from hands-on simulation/visualization, use `"type": "interactive"` with an `interactiveConfig` object containing `conceptName`, `conceptOverview`, `designIdea`, and `subject`. Limit to 1-2 per course.
4. **Scene count**: Based on inferred duration, typically 1-2 scenes per minute
5. **Quiz placement**: Recommend inserting a quiz every 3-5 slides for assessment
6. **Language**: Strictly output all scene titles, descriptions, and keyPoints in the specified course language, and make `languageDirective` explicit enough for downstream prompts.
{{#if mediaEnabled}}
7. **If no suitable source image exists** for a slide scene that would benefit from visuals, add a `mediaGenerations` array. Write media prompts in English. Use globally unique `elementId` values across all scenes (do NOT restart numbering per scene). To reuse generated media in a different scene, reference the same elementId without re-declaring it in mediaGenerations. Each generated media asset should be visually distinct — avoid near-identical media across slides.
{{/if}}
8. **If web search results are provided**, reference specific findings and sources in scene descriptions and keyPoints. The search results provide up-to-date information — incorporate it to make the course content current and accurate.

Please output the JSON object directly without additional explanatory text.
