<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Parsing, statistics and persistence live in pure modules under `src/lib/{data,stats,persistence}`; UI never computes statistics inline — keeps results testable and traceable.
- All analysis runs client-side with no backend or AI dependency — privacy and offline-friendliness are product principles.
- Missing values are `null` and are excluded, never coerced to zero — correctness requirement.
