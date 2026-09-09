---
name: rad-communication
description: "Use this skill whenever the user wants to change how the agent talks — to see, craft, or switch a communication style, to turn the feature on or off, or when they run `/rad-communication`."
user-invocable: true
disable-model-invocation: true
---

# rad-communication

A communication style is a short, user-authored register the agent adopts for its replies.  See the options below to determine your next move.  

>IMPORTANT: When loading a communication style, it is of utmost importance adhere to it throughout the session duration.  It's important that you only use communication styles in how you discuss topics with the user.  This communication style should ABSOLUTELY NOT affect how you write code, comments, or interact with tools and other agents.  It's sole purpose is to better align yourself with the user and only the user.

>IMPORTANT: When switching communication style, it's very important you forget the previously loaded communication style, otherwise, you'll end up mixing styles.

**Check how they called the skill** 
When `$1` doesn't match one of the exact routes below, that's usually someone wanting to talk about communication style and it is not a malformed command — treat it as an invitation to collaborate: probe, offer contrasts, converge on something concrete.

Route on `$1` with the options below:

## No argument — bare `/rad-communication`

You load the currently set default communication style. Run:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" communication-style load
```

- Adopt `data.body` as your communication style for the rest of the session.  

- In one short sentence, acknowledge your new communication style to the user.

## `/rad-communication <slug>`

Loads a specific communication style by its slug name. Run:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" communication-style load --style <slug>
```

- If the call fails because `<slug>` doesn't match anything in the catalog, call `communication-style list` to see a list of communication styles and try to infer the one the user was trying to load by looking at `title` and `description` entries that are returned.

- When you successfully load a communication style, adopt `data.body` as your communication style for the rest of the session.  

- In one short sentence, acknowledge your new communication style to the user.

## `/rad-communication default <slug>`

Naming a default will set that communication as the default:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" communication-style set --selected <slug>
```

- If the call fails because `<slug>` doesn't match anything in the catalog, call `communication-style list` to see a list of communication styles and try to infer the one the user was trying to load by looking at `title` and `description` entries that are returned.

- In one short sentence, acknowledge the new default selected communication style to the user.

## `/rad-communication enable` | `/rad-communication disable`

Enables or disables the default selected communication style so that it runs on the next session start:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" communication-style set --enabled true
```
- `--enabled false` should be used when disabling. 
- In one short sentence, acknowledge that the default communication style will or will not auto-load on session start.

## `/rad-communication help`

### Step 1: Read the philosopy
Read the [references/dimensions.md](./references/dimensions.md) doc to help give context on how the communication style can be applied.  Keep the overall prose summarized and allow the user to ask questions and offer to help them create one if they wish. 

### Step 2: Explain the philosopy
Explain to the user how people differ in how they take in information — a register that reads as crisp to one person reads as curt to another and as padded to a third.  The more clear the communication is tuned to the user's taste, the faster they move.  

### Step 3: Explain token usage
While this feature does not use proxies to directly reduce token usage, the increased productivity of speaking to a user can help reach alignment more quickly and thus, save tokens and the user's mental energy.

### Step 4: List the options
List the full skill options to the user.  Then explain each option to them.

| Invocation | Behavior | Durability |
|---|---|---|
| `/rad-communication` | Manually apply your default communication style to the running session | Session only |
| `/rad-communication <style-name>` | Manually apply a specific communication style `<style-name>` to the running session | Session only |
| `/rad-communication default <style-name>` | Persist `<style-name>` as the your default communication style | Future sessions |
| `/rad-communication enable` \| `disable` | When enabled, your communication style auto-loads on session start | Future sessions |
| `/rad-communication help` | Explain the feature and list the styles | — |
| *anything else* | Opens a collaborative conversation to craft, adjust, or diagnose a style (see below) | — |


### Step 5: Config and available styles:
Cover this with the user as well:

- **Where the setting also lives** — the dashboard's configuration panel.
- **List available styles** — run `communication-style list` and read `data.styles[]`; describe each by its `slug` and `description`, never by filename.  But call them `style names`, not slugs. Always run this so the user sees what they can actually switch to.
- Explain the custom styles live in `~/.radorc/communication-styles/custom` and are remain safe when upgrading Rad Orc.

### Step 6: Offer to help 
Offer the user your services to help create, tune of configure communication style settings.

## Anything else — free-form input

`$1` matched none of the routes above: read whatever was typed as the seed of a real request.  Use their input to help them with crafting a new style from scratch or adjusting an existing one.

Read [references/dimensions.md](./references/dimensions.md) — there you will learn some philosophical guidelines and help guide the user. If you converge on a communication style to create, use the [references/STYLE-TEMPLATE.md](./references/STYLE-TEMPLATE.md) to craft the communication style.  Then save using:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" communication-style save --name <slug> --from <draft-path>
```

Offer to select it with `set --selected custom/<slug>.md` (or `default <slug>` above, to persist and activate in one step). When saving a communication style, advise keeping it short and say why: it loads into the context window on every session. So try to keep the final communication style within 25-50 lines.  If the user wants to increase the size, that is fine.

**Editing a shipped style forks it** — shipped styles are overwritten on upgrade and removed on uninstall, so they are never edited in place. Run `load --style <shipped>`, edit the draft, `save --name <new-slug>` (which only ever writes under `custom/`), then `set --selected custom/<new-slug>.md`, and tell the user they now own the copy. Skip this and an upgrade silently destroys their work.