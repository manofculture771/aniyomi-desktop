package miwayomi.api

import eu.kanade.tachiyomi.network.CloudflareChallengeException
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.http.content.staticResources
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json
import miwayomi.extension.ExtensionManager
import miwayomi.source.AnimeSourceManager
import miwayomi.source.MangaSourceManager
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get

fun Application.registerApi() {
    val mangaSources = Injekt.get<MangaSourceManager>()
    val animeSources = Injekt.get<AnimeSourceManager>()

    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true; explicitNulls = false })
    }

    install(StatusPages) {
        exception<CloudflareChallengeException> { call, cause ->

            println("[miwayomi] Cloudflare challenge at ${cause.url}")
            call.respond(
                HttpStatusCode.InternalServerError,
                ErrorDto(cause.message ?: "Cloudflare challenge", challengeUrl = cause.url, challengeUserAgent = cause.userAgent),
            )
        }
        exception<Throwable> { call, cause ->

            val root = generateSequence(cause) { it.cause }.lastOrNull() ?: cause
            println("[miwayomi] error: ${root.javaClass.simpleName}: ${root.message}")
            cause.printStackTrace(System.out)
            call.respond(
                HttpStatusCode.InternalServerError,
                ErrorDto(cause.message ?: cause::class.simpleName ?: "error"),
            )
        }
    }

    routing {
        // Startup gate: shown before the WebUI. It checks for updates and only
        // redirects to /index.html (the app) once the server is up to date.
        get("/") {
            val html = javaClass.classLoader.getResourceAsStream("webui/startup.html")?.readBytes()
            if (html == null) {
                call.respondText("miwayomi")
            } else {
                call.respondBytes(html, ContentType.Text.Html)
            }
        }

        staticResources("/", "webui")

        get("/api/v1/health") {
            call.respond(HealthDto("ok", "miwayomi", mangaSources.all().size, animeSources.all().size))
        }

        get("/api/v1/sources") {
            val extensionManager = Injekt.get<ExtensionManager>()
            // one broken source must not take the whole list down (the UI has no
            // fallback: an empty list looks like "no extensions installed")
            fun safeName(block: () -> String): String? = runCatching(block).getOrNull()
            val manga = mangaSources.all().mapNotNull { s ->
                safeName { s.name }?.let {
                    SourceDto(id = s.id.toString(), name = it, lang = s.lang, type = "manga",
                        pkg = runCatching { extensionManager.pkgOf(s.id) }.getOrNull())
                }
            }
            val anime = animeSources.all().mapNotNull { s ->
                safeName { s.name }?.let {
                    SourceDto(id = s.id.toString(), name = it, lang = s.lang, type = "anime",
                        pkg = runCatching { extensionManager.pkgOf(s.id) }.getOrNull())
                }
            }
            call.respond(SourcesListDto(manga = manga, anime = anime))
        }
    }

    registerMangaApi()
    registerAnimeApi()
    registerStreamingApi()
    registerPlayerApi()
    registerExtensionApi()
    registerSourcePrefsApi()
    registerFavoritesApi()
    registerWatchApi()
    registerUpdateApi()
}
