import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

import { LSPError } from "./lsp/LSP.js";
import { getLanguage, settings, unstack, listenProperty } from "./util.js";
import { once } from "../troll/src/util.js";

import {
  setup as setupBlueprint,
  logBlueprintError,
} from "./langs/blueprint/blueprint.js";

const { addSignalMethods } = imports.signals;

export default function PanelUI({
  application,
  builder,
  data_dir,
  term_console,
  document_xml,
  document_blueprint,
}) {
  let lang;

  const code_view_xml = document_xml.code_view;
  const code_view_blueprint = document_blueprint.code_view;

  const panel = {
    xml: "",
  };
  addSignalMethods(panel);

  const buffer_blueprint = code_view_blueprint.buffer;
  const buffer_xml = code_view_xml.buffer;

  const button_ui = builder.get_object("button_ui");
  const panel_ui = builder.get_object("panel_ui");

  settings.bind("show-ui", button_ui, "active", Gio.SettingsBindFlags.DEFAULT);
  button_ui.bind_property(
    "active",
    panel_ui,
    "visible",
    GObject.BindingFlags.SYNC_CREATE,
  );

  const stack_ui = builder.get_object("stack_ui");
  const dropdown_ui_lang = builder.get_object("dropdown_ui_lang");
  // TODO: File a bug libadwaita
  // flat does nothing on GtkDropdown or GtkComboBox or GtkComboBoxText
  dropdown_ui_lang.get_first_child().get_style_context().add_class("flat");

  const blueprint = setupBlueprint({
    data_dir,
    document: document_blueprint,
  });

  async function convertToXML() {
    term_console.clear();
    settings.set_boolean("show-console", true);

    const xml = await blueprint.compile(buffer_blueprint.text);
    code_view_xml.replaceText(xml);
  }

  async function convertToBlueprint() {
    term_console.clear();
    settings.set_boolean("show-console", true);

    let blp;

    try {
      blp = await blueprint.decompile(buffer_xml.text);
    } catch (err) {
      if (err instanceof LSPError) {
        logBlueprintError(err);
        return;
      }
      throw err;
    }

    code_view_blueprint.replaceText(blp);
  }

  const button_ui_experimental_blueprint = builder.get_object(
    "button_ui_experimental_blueprint",
  );
  button_ui_experimental_blueprint.connect("clicked", () => {
    const modal = builder.get_object("modal_blueprint_experimental");
    modal.set_transient_for(application.get_active_window());
    modal.present();
  });
  const button_blueprint_documentation = builder.get_object(
    "button_blueprint_documentation",
  );
  button_blueprint_documentation.connect("clicked", () => {
    Gtk.show_uri(
      null,
      "https://jwestman.pages.gitlab.gnome.org/blueprint-compiler/",
      null,
    );
  });

  let handler_id_xml = null;
  let handler_id_blueprint = null;

  // FIXME we should wait for previewer update instead
  // when loading demo
  async function update() {
    if (lang.id === "blueprint") {
      await blueprint.update(buffer_blueprint.text);
      await once(
        blueprint.lspc,
        "notification::textDocument/x-blueprintcompiler/publishCompiled",
      );
    } else if (lang.id === "xml") {
      onXML(buffer_xml.text);
    }
  }

  function onXML(xml) {
    panel.xml = xml || "";
    panel.emit("updated");
  }

  const onBlueprint = unstack(function onBlueprint() {
    return blueprint.update(buffer_blueprint.text);
  });

  function start() {
    stop();
    lang = getLanguage(dropdown_ui_lang.selected_item.string);
    handler_id_xml = code_view_xml.connect("changed", () => {
      if (lang.id !== "xml") return;
      onXML(code_view_xml.buffer.text);
    });
    handler_id_blueprint = code_view_blueprint.connect("changed", onBlueprint);
    blueprint.lspc.connect(
      "notification::textDocument/x-blueprintcompiler/publishCompiled",
      (_self, { xml }) => {
        if (lang.id !== "blueprint") return;
        onXML(xml);
      },
    );
  }

  function stop() {
    if (handler_id_xml !== null) {
      code_view_xml.disconnect(handler_id_xml);
      handler_id_xml = null;
    }
    if (handler_id_blueprint !== null) {
      code_view_blueprint.disconnect(handler_id_blueprint);
      handler_id_blueprint = null;
    }
  }

  async function onChangeLang(value) {
    if (value === 0) {
      try {
        await convertToXML();
      } catch (err) {
        logError(err);
        dropdown_ui_lang.block();
        dropdown_ui_lang.set_selected(1);
        dropdown_ui_lang.unblock();
        return;
      }
    } else if (value === 1) {
      try {
        await convertToBlueprint();
      } catch (err) {
        logError(err);
        dropdown_ui_lang.block();
        dropdown_ui_lang.set_selected(0);
        dropdown_ui_lang.unblock();
        return;
      }
    }

    settings.set_int("ui-language", dropdown_ui_lang.selected);
    setupLanguage();
  }

  dropdown_ui_lang.set_selected(settings.get_int("ui-language"));
  listenProperty(dropdown_ui_lang, "selected", (value) => {
    onChangeLang(value).catch(logError);
  });

  function setupLanguage() {
    start();
    stack_ui.set_visible_child_name(lang.id);
    button_ui_experimental_blueprint.visible = lang.id === "blueprint";
  }
  setupLanguage();

  panel.start = start;
  panel.stop = stop;
  panel.update = update;
  panel.panel = panel_ui;

  return panel;
}
