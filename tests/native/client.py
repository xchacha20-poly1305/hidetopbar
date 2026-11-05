import os
import sys
from pathlib import Path

import gi

gi.require_version('Gtk', '4.0')
from gi.repository import Gtk

mode = sys.argv[1]
app = Gtk.Application(application_id='org.example.HideTopBarNativeTest')


def activate(application):
    title = 'HideTopBarDragWindow' if mode == 'drag' else 'HideTopBarTestWindow'
    window = Gtk.ApplicationWindow(application=application, title=title)
    window.set_decorated(False)
    window.set_default_size(700, 500)
    if mode == 'drag':
        handle = Gtk.WindowHandle()
        handle.set_child(Gtk.Label(label='Touch-drag test surface'))
        window.set_child(handle)
        window.maximize()
    else:
        button = Gtk.Button(label='Touch test surface')
        button.connect('clicked', lambda *_: Path(os.environ['HIDETOPBAR_CLICK_RESULT']).write_text('clicked'))
        window.set_child(button)
        window.fullscreen()
    window.present()


app.connect('activate', activate)
app.run()
