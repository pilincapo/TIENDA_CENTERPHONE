"""Helper para reemplazar texto respetando los finales de linea de cada archivo.

El repo tiene archivos con LF, con CRLF e incluso MIXTOS (src/shared/types.ts), y
con eso un `replace` con "\n" a medias falla en silencio o rompe el archivo: el
cambio no se aplica y el commit sale sin lo que creiamos. Este helper falla
ruidosamente si no encuentra la coincidencia exacta.

Uso:
    import sys; sys.path.insert(0, "tools")
    from patch_lineendings import patch
    patch("src/worker/admin.ts", viejo, nuevo)
"""


def patch(path, old, new, count=1):
    """Reemplaza `old` por `new` adaptandolo al final de linea que usa el archivo."""
    s = open(path, encoding="utf-8", newline="").read()
    if s.count(old) == count:
        s = s.replace(old, new, count)
    else:
        if "\r\n" in s and "\r\n" not in old:
            alt_old, alt_new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
        elif "\r\n" not in s and "\r\n" in old:
            alt_old, alt_new = old.replace("\r\n", "\n"), new.replace("\r\n", "\n")
        else:
            raise AssertionError(f"{path}: se esperaban {count} coincidencias, hay {s.count(old)}")
        if s.count(alt_old) != count:
            raise AssertionError(f"{path}: se esperaban {count} coincidencias (CRLF), hay {s.count(alt_old)}")
        s = s.replace(alt_old, alt_new, count)
    open(path, "w", encoding="utf-8", newline="").write(s)
    return True
