// The words Rust says itself — the tray, the windows' titles, the messages a
// command answers with — in English, Spanish and Portuguese.
//
// The language is the setting (`Settings::language`): "en", "es" or "pt", or
// "system", which follows Windows. Rust reads no locale of its own: the island's
// page tells it the system's language (`set_system_language`, from the
// WebView's own, which follows Windows), and until it has, English is said.
// The front end has its own tables (src/core/i18n); these are only Rust's.

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    En,
    Es,
    Pt,
}

impl Lang {
    /// A language tag as one of the three: es-* and pt-* by their first part, anything else English.
    pub fn of_tag(tag: &str) -> Lang {
        let base = tag.trim().split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
        match base.as_str() {
            "es" => Lang::Es,
            "pt" => Lang::Pt,
            _ => Lang::En,
        }
    }

    fn to_u8(self) -> u8 {
        match self {
            Lang::En => 0,
            Lang::Es => 1,
            Lang::Pt => 2,
        }
    }

    fn from_u8(n: u8) -> Lang {
        match n {
            1 => Lang::Es,
            2 => Lang::Pt,
            _ => Lang::En,
        }
    }
}

/// "Follow the system", kept where a language would be.
const SYSTEM: u8 = 255;
/// The setting: one of the three, or SYSTEM.
static CHOSEN: AtomicU8 = AtomicU8::new(SYSTEM);
/// The system's language, as the island's page last said it.
static SYSTEM_LANG: AtomicU8 = AtomicU8::new(0);

/// The language Rust speaks now.
pub fn current() -> Lang {
    match CHOSEN.load(Ordering::Relaxed) {
        SYSTEM => Lang::from_u8(SYSTEM_LANG.load(Ordering::Relaxed)),
        n => Lang::from_u8(n),
    }
}

/// The setting changed (or was read at launch). True when the language spoken changed.
pub fn set_setting(language: &str) -> bool {
    let before = current();
    let chosen = if language == "system" { SYSTEM } else { Lang::of_tag(language).to_u8() };
    CHOSEN.store(chosen, Ordering::Relaxed);
    current() != before
}

/// The island's page says what the system's language is. True when the language spoken changed.
pub fn set_system(tag: &str) -> bool {
    let before = current();
    SYSTEM_LANG.store(Lang::of_tag(tag).to_u8(), Ordering::Relaxed);
    current() != before
}

/// Everything Rust says, by name. (The reply messages of a Windows terminal are not said on Linux.)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum Text {
    TrayOpen,
    TraySettings,
    TrayPause,
    TrayQuit,
    ShowIsland,
    HideIsland,
    ShowAgents,
    HideAgents,
    SettingsTitle,
    AgentsTitle,
    ShortcutTaken,
    ShortcutTwice,
    ShortcutNeedsMod,
    ShortcutWinKey,
    ShortcutWindows,
    ShortcutCtrlAltDel,
    ShortcutStartMenu,
    ShortcutEditing,
    UpdateUnreachable,
    UpdateNoAnswer,
    UpdateFailed,
    UpdateNoCurl,
    /// Said on Linux, where no player tells Oleo anything.
    #[cfg_attr(windows, allow(dead_code))]
    MediaUnavailable,
    MediaNoAnswer,
    NoChange,
    ReplyWrongTool,
    ReplyEmpty,
    ReplyTooLong,
    ReplyNoId,
    ReplyNoFolder,
    ReplyNoLogFolder,
    ReplyNoLogFile,
    ReplyNotStarted,
    ReplyBadChar,
    ReplyNoPanelId,
    ReplyTooLongPanelMax,
    ReplyTooLongPanel,
    ReplyNoWhere,
    ReplyNotDelivered,
    ReplyCantType,
    ReplyOtherTab,
    ReplyAdmin,
    ReplyNoForeground,
    ReplyLostKeyboard,
    ReplyNoKeystrokes,
    ReplyEditorTerminal,
    ReplyNoEditor,
}

/// `text` in the language spoken now.
pub fn tr(text: Text) -> &'static str {
    tr_in(current(), text)
}

/// `text` with `{name}` filled in, in the language spoken now.
pub fn trf(text: Text, name: &str, value: &str) -> String {
    tr(text).replace(&format!("{{{name}}}"), value)
}

/// `text` in `lang`: English, Spanish, Portuguese.
pub fn tr_in(lang: Lang, text: Text) -> &'static str {
    let [en, es, pt] = words(text);
    match lang {
        Lang::En => en,
        Lang::Es => es,
        Lang::Pt => pt,
    }
}

fn words(text: Text) -> [&'static str; 3] {
    use Text::*;
    match text {
        TrayOpen => ["Open Oleo", "Abrir Oleo", "Abrir o Oleo"],
        TraySettings => ["Settings…", "Ajustes…", "Ajustes…"],
        TrayPause => ["Pause", "Pausar", "Pausar"],
        TrayQuit => ["Quit", "Salir", "Sair"],
        ShowIsland => ["Show island", "Mostrar isla", "Mostrar ilha"],
        HideIsland => ["Hide island", "Ocultar isla", "Ocultar ilha"],
        ShowAgents => ["Show agents list", "Mostrar lista de agentes", "Mostrar lista de agentes"],
        HideAgents => ["Hide agents list", "Ocultar lista de agentes", "Ocultar lista de agentes"],
        SettingsTitle => ["Settings — Oleo", "Ajustes — Oleo", "Ajustes — Oleo"],
        AgentsTitle => ["Agents — Oleo", "Agentes — Oleo", "Agentes — Oleo"],
        ShortcutTaken => [
            "Already used by another app — pick another",
            "Ya lo usa otra app — elige otro",
            "Já usado por outro app — escolha outro",
        ],
        ShortcutTwice => [
            "Already another Oleo shortcut — pick another",
            "Ya es otro atajo de Oleo — elige otro",
            "Já é outro atalho do Oleo — escolha outro",
        ],
        ShortcutNeedsMod => [
            "Press a key together with Ctrl, Alt or Win",
            "Pulsa una tecla junto con Ctrl, Alt o Win",
            "Pressione uma tecla junto com Ctrl, Alt ou Win",
        ],
        ShortcutWinKey => [
            "Windows keeps the Win key's shortcuts for itself — pick another",
            "Windows se reserva los atajos de la tecla Win — elige otro",
            "O Windows reserva os atalhos da tecla Win — escolha outro",
        ],
        ShortcutWindows => [
            "Windows uses that one for its windows — pick another",
            "Windows lo usa para sus ventanas — elige otro",
            "O Windows usa esse para as janelas — escolha outro",
        ],
        ShortcutCtrlAltDel => [
            "Windows keeps Ctrl+Alt+Del for itself — pick another",
            "Windows se reserva Ctrl+Alt+Supr — elige otro",
            "O Windows reserva Ctrl+Alt+Del — escolha outro",
        ],
        ShortcutStartMenu => [
            "Windows uses that one for the Start menu and the Task Manager — pick another",
            "Windows lo usa para el menú Inicio y el Administrador de tareas — elige otro",
            "O Windows usa esse para o menu Iniciar e o Gerenciador de Tarefas — escolha outro",
        ],
        ShortcutEditing => [
            "Every program uses that one (copy, paste, undo, save…) — pick another",
            "Todos los programas lo usan (copiar, pegar, deshacer, guardar…) — elige otro",
            "Todo programa usa esse (copiar, colar, desfazer, salvar…) — escolha outro",
        ],
        UpdateUnreachable => [
            "Couldn't reach GitHub. Check your connection and try again.",
            "No se pudo contactar con GitHub. Revisa tu conexión y vuelve a intentarlo.",
            "Não foi possível acessar o GitHub. Verifique a conexão e tente de novo.",
        ],
        UpdateNoAnswer => [
            "GitHub didn't give an answer just now. Try again in a little while.",
            "GitHub no respondió ahora. Vuelve a intentarlo en un rato.",
            "O GitHub não respondeu agora. Tente de novo daqui a pouco.",
        ],
        UpdateFailed => [
            "The update check failed. Try again later.",
            "La búsqueda de actualizaciones falló. Inténtalo más tarde.",
            "A busca por atualizações falhou. Tente mais tarde.",
        ],
        UpdateNoCurl => [
            "Oleo needs curl to check for updates, and couldn't find it on this computer.",
            "Oleo necesita curl para buscar actualizaciones y no lo encontró en este equipo.",
            "O Oleo precisa do curl para buscar atualizações e não o encontrou neste computador.",
        ],
        MediaUnavailable => [
            "Media controls are not available on this system.",
            "Los controles multimedia no están disponibles en este sistema.",
            "Os controles de mídia não estão disponíveis neste sistema.",
        ],
        MediaNoAnswer => [
            "Windows would not say what is playing ({err}).",
            "Windows no quiso decir qué está sonando ({err}).",
            "O Windows não informou o que está tocando ({err}).",
        ],
        NoChange => ["No change.", "Sin cambios.", "Sem mudanças."],
        ReplyWrongTool => [
            "Replies can only be sent to Claude Code or Codex sessions.",
            "Solo se puede responder a sesiones de Claude Code o Codex.",
            "Só é possível responder a sessões do Claude Code ou Codex.",
        ],
        ReplyEmpty => ["Write a message first.", "Escribe un mensaje primero.", "Escreva uma mensagem primeiro."],
        ReplyTooLong => [
            "That message is too long (the limit is {max} characters).",
            "Ese mensaje es demasiado largo (el límite es de {max} caracteres).",
            "Essa mensagem é longa demais (o limite é de {max} caracteres).",
        ],
        ReplyNoId => [
            "This session has no id a reply can be sent to.",
            "Esta sesión no tiene un id al que enviar una respuesta.",
            "Esta sessão não tem um id para onde enviar uma resposta.",
        ],
        ReplyNoFolder => [
            "The session's folder no longer exists.",
            "La carpeta de la sesión ya no existe.",
            "A pasta da sessão não existe mais.",
        ],
        ReplyNoLogFolder => [
            "Oleo could not prepare its log folder.",
            "Oleo no pudo preparar su carpeta de registros.",
            "O Oleo não conseguiu preparar a pasta de logs.",
        ],
        ReplyNoLogFile => [
            "Oleo could not open its log file.",
            "Oleo no pudo abrir su archivo de registro.",
            "O Oleo não conseguiu abrir o arquivo de log.",
        ],
        ReplyNotStarted => [
            "The reply could not be started.",
            "No se pudo iniciar la respuesta.",
            "Não foi possível iniciar a resposta.",
        ],
        ReplyBadChar => [
            "That message has a character that can't be typed.",
            "Ese mensaje tiene un carácter que no se puede escribir.",
            "Essa mensagem tem um caractere que não pode ser digitado.",
        ],
        ReplyNoPanelId => [
            "This session has no id the Claude Code panel can be opened with.",
            "Esta sesión no tiene un id con el que abrir el panel de Claude Code.",
            "Esta sessão não tem um id para abrir o painel do Claude Code.",
        ],
        ReplyTooLongPanelMax => [
            "That message is too long for the panel ({max} characters at most).",
            "Ese mensaje es demasiado largo para el panel ({max} caracteres como máximo).",
            "Essa mensagem é longa demais para o painel (no máximo {max} caracteres).",
        ],
        ReplyTooLongPanel => [
            "That message is too long for the panel.",
            "Ese mensaje es demasiado largo para el panel.",
            "Essa mensagem é longa demais para o painel.",
        ],
        ReplyNoWhere => [
            "Oleo doesn't know where this session runs.",
            "Oleo no sabe dónde se ejecuta esta sesión.",
            "O Oleo não sabe onde esta sessão roda.",
        ],
        ReplyNotDelivered => [
            "The reply could not be delivered.",
            "No se pudo entregar la respuesta.",
            "Não foi possível entregar a resposta.",
        ],
        ReplyCantType => [
            "This session's window can't be typed into.",
            "No se puede escribir en la ventana de esta sesión.",
            "Não é possível digitar na janela desta sessão.",
        ],
        ReplyOtherTab => [
            "Its terminal is showing another tab.",
            "Su terminal muestra otra pestaña.",
            "O terminal está mostrando outra aba.",
        ],
        ReplyAdmin => [
            "Its terminal runs as administrator.",
            "Su terminal se ejecuta como administrador.",
            "O terminal roda como administrador.",
        ],
        ReplyNoForeground => [
            "Its terminal couldn't be brought forward.",
            "No se pudo traer su terminal al frente.",
            "Não foi possível trazer o terminal para a frente.",
        ],
        ReplyLostKeyboard => [
            "Its terminal lost the keyboard.",
            "Su terminal perdió el teclado.",
            "O terminal perdeu o teclado.",
        ],
        ReplyNoKeystrokes => [
            "Windows would not take the keystrokes.",
            "Windows no aceptó las pulsaciones.",
            "O Windows não aceitou as teclas.",
        ],
        ReplyEditorTerminal => [
            "This session runs in the editor's terminal, which can't be picked from outside.",
            "Esta sesión se ejecuta en la terminal del editor, que no se puede elegir desde fuera.",
            "Esta sessão roda no terminal do editor, que não pode ser escolhido de fora.",
        ],
        ReplyNoEditor => [
            "Its editor couldn't be brought forward.",
            "No se pudo traer su editor al frente.",
            "Não foi possível trazer o editor para a frente.",
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_fall_to_the_three() {
        assert_eq!(Lang::of_tag("es-CL"), Lang::Es);
        assert_eq!(Lang::of_tag("es"), Lang::Es);
        assert_eq!(Lang::of_tag("pt_BR"), Lang::Pt);
        assert_eq!(Lang::of_tag("PT-pt"), Lang::Pt);
        assert_eq!(Lang::of_tag("en-GB"), Lang::En);
        assert_eq!(Lang::of_tag("fr-FR"), Lang::En);
        assert_eq!(Lang::of_tag(""), Lang::En);
    }

    #[test]
    fn every_text_is_said_in_every_language() {
        for lang in [Lang::En, Lang::Es, Lang::Pt] {
            for text in [Text::TrayOpen, Text::ShortcutTaken, Text::UpdateFailed, Text::ReplyTooLong, Text::ReplyNoEditor] {
                assert!(!tr_in(lang, text).is_empty());
            }
        }
        assert_eq!(tr_in(Lang::Es, Text::HideIsland), "Ocultar isla");
        assert_eq!(tr_in(Lang::Pt, Text::TrayQuit), "Sair");
        assert!(tr_in(Lang::En, Text::ReplyTooLong).contains("{max}"));
    }
}
