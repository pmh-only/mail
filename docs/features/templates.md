# Message templates

Message templates insert reusable content into the composer. They are useful for recurring replies,
standard introductions, and small snippets.

## Behavior

- A template has a name, optional subject, HTML body, and a Template or Snippet label.
- Inserting a template adds its HTML at the current editor position.
- Its subject is applied only when the draft subject is empty.
- Templates can be created, edited, and deleted from Settings.
- Insertion immediately updates the current draft, which is then saved by the normal draft flow.

The Template and Snippet labels help organize the picker; both insert content without sending the
message automatically.

## Configuration

| Item              | Setting name                                  | Environment variable | Requirement                                            |
| ----------------- | --------------------------------------------- | -------------------- | ------------------------------------------------------ |
| Template          | `Settings > Templates > Name` and `Body HTML` | None                 | Name and body are required.                            |
| Optional subject  | `Settings > Templates > Subject`              | None                 | Optional; used only when the current subject is empty. |
| Snippet label     | `Settings > Templates > Treat as snippet`     | None                 | Optional.                                              |
| Insert a template | `Composer > Advanced > Templates`             | None                 | At least one template must exist.                      |

No template-specific environment variable is available or required.
