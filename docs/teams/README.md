# Team status files

Each team keeps `docs/teams/<team>/STATUS.md` (team = `db`, `proc`, `fe`, `ux`, `qa`, `sec`; ARCH reports in
`docs/IMPLEMENTATION_STATUS.md`). Update it in every PR the team opens. Facts only: never record a test as passed
without having run it, and give the command and the real counts.

```markdown
# <TEAM> status — CDF V13 Enterprise (synthetic data only)

Updated: <UTC date and time> · Branch: <branch> · Head: <sha>

## Completed
- <task id> — <what> — PR <link> — <state: IN_REVIEW / DONE>

## Changed files
- <paths>

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |

## Unresolved defects
- <id, severity, what, next step>

## Dependencies and requests
- <what this team needs, from whom (through ARCH)>
```
