"""
Paginación ligera para vistas APIView que devuelven listas.

DRF trae PageNumberPagination, pero nuestras vistas construyen dicts a mano (no usan
ListAPIView), así que este helper pagina un queryset y devuelve un sobre uniforme:

    {
      "results": [...],           # solo la página pedida
      "page": 1, "page_size": 25,
      "total": 1234, "total_pages": 50,
      "has_next": true, "has_prev": false
    }

Clave de rendimiento: se ejecuta COUNT una vez y se corta el queryset con OFFSET/LIMIT,
así nunca se cargan en memoria todos los giros (que pueden ser millones).
"""
from django.core.paginator import Paginator

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100


def _int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def paginate(request, queryset, serialize):
    """
    `serialize(items)` recibe la lista de objetos de la página y devuelve la lista de
    dicts ya serializada. Devuelve el sobre con resultados + metadatos.
    """
    page_size = min(MAX_PAGE_SIZE, max(1, _int(request.query_params.get("page_size"), DEFAULT_PAGE_SIZE)))
    page_num = max(1, _int(request.query_params.get("page"), 1))

    paginator = Paginator(queryset, page_size)
    page = paginator.get_page(page_num)  # tolera páginas fuera de rango

    return {
        "results": serialize(list(page.object_list)),
        "page": page.number,
        "page_size": page_size,
        "total": paginator.count,
        "total_pages": paginator.num_pages,
        "has_next": page.has_next(),
        "has_prev": page.has_previous(),
    }
