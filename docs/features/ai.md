# AI features

mail uses the OpenAI Responses API for optional, bounded assistance. OpenAI is disabled until an API
key is configured. The selected model is shared by every AI operation.

## Available actions

| Feature                    | Behavior                                                                                 | Data sent to OpenAI                                           |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Compose assistance         | Improve a draft or rewrite it to be concise, formal, or friendly.                        | Recipients, subject, and current draft content.               |
| Reply draft                | Generate a proposed reply from an opened message or thread.                              | Relevant message text and addressing context.                 |
| Message and thread summary | Summarize one thread or a recent mailbox window.                                         | Subject, sender, recipients, previews, and bounded body text. |
| Action extraction          | Find explicit tasks, owners, dates, and priorities in a thread.                          | Bounded text from each thread message.                        |
| Translation                | Translate an opened message into the preferred language.                                 | Message content and target language.                          |
| Attachment summary         | Summarize supported text-like attachments and cache the result.                          | Extracted attachment text.                                    |
| Natural-language search    | Translate a request into bounded archive searches and select relevant returned messages. | The query and bounded metadata from search candidates.        |
| Importance classification  | Mark incoming messages likely to need attention.                                         | Incoming message metadata and bounded content.                |

The application requests `store: false`, limits input and output sizes, and treats email content as
untrusted input. These controls do not replace reviewing the OpenAI account's own retention and data
processing terms.

## Automatic classification

Importance classification is the only automatic AI feature. When enabled, the worker processes
newly synchronized messages in the background. Disable it to retain all on-demand AI actions without
automatically sending incoming mail content to OpenAI.

## Configuration

| Item                      | Setting name                                                | Environment variable               | Requirement                                                                                               |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| All AI actions            | `Settings > AI Features > OpenAI API key`                   | `OPENAI_API_KEY`                   | Required. A saved key takes precedence over the environment.                                              |
| Model                     | `Settings > AI Features > Model`                            | `OPENAI_MODEL`                     | Optional; defaults to `gpt-4.1-mini`.                                                                     |
| Automatic importance      | `Settings > AI Features > Classify important incoming mail` | `OPENAI_IMPORTANCE_CLASSIFICATION` | Optional; defaults to enabled when an API key exists. Set the environment value to `false` to disable it. |
| Translation language      | `Settings > AI Features > Mail translation target language` | None                               | Optional; defaults to `Korean`.                                                                           |
| Stored API key encryption | None                                                        | `MAIL_SECRET_KEY`                  | Required to encrypt an API key saved through Settings.                                                    |

Automatic classification requires the worker. On-demand actions run through authenticated web
requests. Demo mode returns sample AI results without calling OpenAI.
