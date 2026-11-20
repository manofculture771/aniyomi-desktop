package miwayomi.api

import eu.kanade.tachiyomi.animesource.AnimeCatalogueSource
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytesWriter
import io.ktor.utils.io.writeFully
import miwayomi.source.AnimeSourceManager
import miwayomi.source.MangaSourceManager

internal fun ApplicationCall.sourceId(): Long? =
    parameters["sourceId"]?.toLongOrNull()

internal fun ApplicationCall.requiredUrl(): String? =
    request.queryParameters["url"]?.takeIf { it.isNotBlank() }

internal fun ApplicationCall.episodeFromQuery(url: String): SEpisode =
    SEpisode.create().also { ep ->
        val q = request.queryParameters
        ep.url = url
        ep.name = q["name"]?.takeIf { it.isNotBlank() }
            ?: url.substringAfterLast('/').substringBefore('#').ifBlank { "Episode" }
        ep.episode_number = q["episode_number"]?.toFloatOrNull() ?: -1f
        ep.scanlator = q["scanlator"]?.takeIf { it.isNotBlank() }
        ep.date_upload = q["date_upload"]?.toLongOrNull() ?: 0L
    }

/**
 * SAnime.title is lateinit too: extensions that read `anime.title` while
 * fetching details or episodes throw UninitializedPropertyAccessException when
 * the API hands them a URL-only stub. The UI sends the title it already has.
 */
internal fun ApplicationCall.animeFromQuery(url: String): SAnime =
    SAnime.create().also { a ->
        val q = request.queryParameters
        a.url = url
        a.title = q["title"]?.takeIf { it.isNotBlank() }
            ?: url.substringAfterLast('/').substringBefore('#').ifBlank { "Anime" }
        a.thumbnail_url = q["thumbnail_url"]?.takeIf { it.isNotBlank() }
    }

/** Same lateinit trap for manga: SManga.title must be set before extensions run. */
internal fun ApplicationCall.mangaFromQuery(url: String): SManga =
    SManga.create().also { m ->
        val q = request.queryParameters
        m.url = url
        m.title = q["title"]?.takeIf { it.isNotBlank() }
            ?: url.substringAfterLast('/').substringBefore('#').ifBlank { "Manga" }
        m.thumbnail_url = q["thumbnail_url"]?.takeIf { it.isNotBlank() }
    }

/** SChapter.name is lateinit as well; most page parsers read it. */
internal fun ApplicationCall.chapterFromQuery(url: String): SChapter =
    SChapter.create().also { c ->
        val q = request.queryParameters
        c.url = url
        c.name = q["name"]?.takeIf { it.isNotBlank() }
            ?: url.substringAfterLast('/').substringBefore('#').ifBlank { "Chapter" }
        c.chapter_number = q["chapter_number"]?.toFloatOrNull() ?: -1f
        c.scanlator = q["scanlator"]?.takeIf { it.isNotBlank() }
        c.date_upload = q["date_upload"]?.toLongOrNull() ?: 0L
    }

internal fun Long?.manga(manager: MangaSourceManager): CatalogueSource? =
    this?.let { manager.get(it) as? CatalogueSource }

internal fun Long?.anime(manager: AnimeSourceManager): AnimeCatalogueSource? =
    this?.let { manager.get(it) as? AnimeCatalogueSource }

internal suspend fun ApplicationCall.respondNotFound() =
    respond(HttpStatusCode.NotFound, ErrorDto("Source not found"))

internal suspend fun ApplicationCall.respondMissingUrl() =
    respond(HttpStatusCode.BadRequest, ErrorDto("url is required"))

internal suspend fun ApplicationCall.proxyStream(
    upstream: okhttp3.Response,
    contentType: String,
    status: HttpStatusCode,
) {
    val body = upstream.body
    if (body == null) {
        upstream.close()
        respond(status, ErrorDto("empty body"))
        return
    }
    upstream.header("Content-Range")?.let { response.headers.append(HttpHeaders.ContentRange, it) }
    upstream.header("Accept-Ranges")?.let { response.headers.append(HttpHeaders.AcceptRanges, it) }
    upstream.header("Content-Length")?.let { response.headers.append(HttpHeaders.ContentLength, it) }
    try {
        respondBytesWriter(ContentType.parse(contentType), status) {
            val input = body.byteStream()
            try {
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    writeFully(buf, 0, n)
                }
            } finally {
                runCatching { input.close() }
            }
        }
    } finally {
        upstream.close()
    }
}
