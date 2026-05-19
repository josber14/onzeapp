---
name: onze-memory
description: Use when updating MEMORY.md or any project memory file. Use when a significant change is made: new feature, bug fix, refactor, ADR, dependency change, or deployment config change.
---

# onze-memory

Después de cada cambio significativo en el proyecto ONZE/ZINPLE, actualiza MEMORY.md:

1. **Changelog**: Agrega entrada con fecha y descripción del cambio
2. **Features**: Si es una feature nueva, márcala como `[x]` en la lista de features implementadas
3. **ADR**: Si es una decisión arquitectónica relevante, agrega un nuevo ADR numerado
4. **Próximos pasos**: Si completaste algo pendiente, muévelo a implemented; si descubriste algo nuevo, agrégalo

Formato de changelog:
```markdown
### YYYY-MM-DD — Breve descripción
- Feature/Bug/Refactor: detalle del cambio
- Archivos modificados: ruta1, ruta2
```
