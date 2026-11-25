## Summary

Describe the change.

## Validation

- [ ] `ruff check --config backend/pyproject.toml backend/opentalking/core backend/opentalking/events backend/opentalking/avatar backend/apps backend/tests`
- [ ] `mypy --config-file backend/pyproject.toml backend/opentalking/core backend/opentalking/events backend/opentalking/avatar backend/apps --ignore-missing-imports`
- [ ] `pytest backend/tests frontend/tests/regression`
- [ ] `cd frontend && npm run build`

## Notes

List migration impact, operational changes, or follow-up items.
