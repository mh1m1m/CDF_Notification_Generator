// PersonaMenu: the signed-in synthetic persona, the role held in the active workspace, and sign-out. A disclosure that
// works without JavaScript; the persona is always labelled synthetic.
import { PersonIcon } from "@/components/icons";
import type { Translator } from "@/lib/i18n";
import { Disclosure } from "./Disclosure";

export interface PersonaMenuProps {
  t: Translator;
  /** Localised synthetic persona name, e.g. "Secretary Alpha". */
  name: string;
  /** Localised role held in the active workspace. */
  roleLabel: string;
  signOutAction: (formData: FormData) => Promise<void>;
}

export function PersonaMenu({ t, name, roleLabel, signOutAction }: PersonaMenuProps) {
  return (
    <Disclosure
      className="v13-persona-menu"
      testId="persona-menu"
      panelLabel={t("shell.persona.menuLabel")}
      summaryProps={{ "data-testid": "persona-menu-button" }}
      summary={
        <>
          <PersonIcon />
          <span className="v13-sr-only">{t("shell.signedInAs")}</span>
          <span>{name}</span>
        </>
      }
    >
      <div className="v13-persona-facts">
        <p className="v13-strong" data-testid="persona-menu-name">
          {name}
        </p>
        <p data-testid="persona-menu-role">{roleLabel}</p>
        <p className="v13-muted">{t("shell.persona.synthetic")}</p>
      </div>
      <form action={signOutAction}>
        <button type="submit" className="v13-menu-button" data-testid="sign-out">
          {t("shell.signOut")}
        </button>
      </form>
    </Disclosure>
  );
}
