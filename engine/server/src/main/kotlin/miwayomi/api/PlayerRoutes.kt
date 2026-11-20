package miwayomi.api

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import miwayomi.di.ConfigHolder
import java.io.File

@Serializable
data class SubTrack(val lang: String = "", val content: String = "")

@Serializable
data class LaunchRequest(
    val url: String = "",
    val title: String = "",
    val subs: List<SubTrack> = emptyList(),
)

@Serializable
data class LaunchResult(val ok: Boolean, val player: String? = null, val error: String? = null)

private fun findMpv(): String? {
    System.getenv("ProgramFiles")?.let { pf ->
        File(pf).listFiles { f -> f.isDirectory && f.name.startsWith("mpv", ignoreCase = true) }
            ?.sortedByDescending { it.name }
            ?.forEach { dir ->
                val exe = File(dir, "mpv.exe")
                if (exe.isFile) return exe.absolutePath
            }
        val plain = File(pf, "mpv\\mpv.exe")
        if (plain.isFile) return plain.absolutePath
    }
    System.getenv("LOCALAPPDATA")?.let { appData ->
        val local = File(appData, "mpv\\mpv.exe")
        if (local.isFile) return local.absolutePath
    }
    return null
}

/**
 * Writes subtitle payloads to disk so mpv can load them.
 *
 * The extension hands out subtitle URLs on its own tiny HTTP server; the page
 * fetches them through the local proxy and posts the text here, so mpv gets a
 * plain file and never has to know about headers, cookies or expiring URLs.
 */
private fun writeSubs(subs: List<SubTrack>, title: String): List<Pair<String, String>> {
    if (subs.isEmpty()) return emptyList()
    val dir = File(ConfigHolder.config.dataDir, "subs").apply { mkdirs() }
    val safe = title.ifBlank { "episode" }.replace(Regex("[^A-Za-z0-9 _-]"), "_").take(60)
    val written = mutableListOf<Pair<String, String>>()
    subs.take(6).forEachIndexed { i, track ->
        // mpv/libass silently drop the last cue when the file does not end with a
        // blank line, and trim() would remove it again: normalise instead.
        val text = track.content.replace("\r\n", "\n").trimStart()
        if (text.isBlank() || text.length > 3_000_000) return@forEachIndexed
        val normalized = if (text.endsWith("\n\n")) text else text.trimEnd() + "\n\n"
        val isVtt = text.startsWith("WEBVTT", ignoreCase = true)
        val file = File(dir, "$safe.${i + 1}.${if (isVtt) "vtt" else "srt"}")
        runCatching { file.writeText(normalized) }.onSuccess {
            written += (track.lang.ifBlank { "Track ${i + 1}" }) to file.absolutePath
        }
    }
    return written
}

/**
 * Hands the current stream to a real media player (mpv).
 *
 * Only same-origin proxy URLs are accepted: the page always plays through
 * /api/v1/hls or /api/v1/proxy, so anything else would be an SSRF hole.
 */
fun Application.registerPlayerApi() {
    routing {
        post("/api/v1/player/launch") {
            val req = runCatching { call.receive<LaunchRequest>() }
                .onFailure { println("[miwayomi] player/launch parse failed: ${it.javaClass.simpleName}: ${it.message}") }
                .getOrNull()
            if (req == null || req.url.isBlank()) {
                return@post call.respond(HttpStatusCode.BadRequest, LaunchResult(false, error = "url required"))
            }
            val allowed = req.url.startsWith("http://127.0.0.1:") || req.url.startsWith("http://localhost:")
            if (!allowed) {
                return@post call.respond(HttpStatusCode.BadRequest, LaunchResult(false, error = "only local proxy URLs"))
            }
            val mpv = findMpv()
                ?: return@post call.respond(HttpStatusCode.NotFound, LaunchResult(false, error = "mpv not installed"))
            try {
                val subs = writeSubs(req.subs, req.title)
                val cmd = mutableListOf(mpv, "--force-window=yes", "--no-terminal", "--really-quiet")
                if (req.title.isNotBlank()) cmd += "--title=${req.title}"
                subs.forEach { (_lang, path) ->
                    cmd += "--sub-file=$path"
                }
                if (subs.isNotEmpty()) {
                    cmd += "--sid=1"
                    cmd += "--slang=${subs.joinToString(",") { it.first }}"
                }
                cmd += req.url
                ProcessBuilder(cmd).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start()
                println("[miwayomi] mpv launched with ${subs.size} subtitle track(s)")
                call.respond(LaunchResult(true, player = mpv))
            } catch (e: Exception) {
                call.respond(HttpStatusCode.InternalServerError, LaunchResult(false, error = e.message ?: "launch failed"))
            }
        }
    }
}
