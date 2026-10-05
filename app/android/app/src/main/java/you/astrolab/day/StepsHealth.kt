package you.astrolab.day

import android.content.Context
import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByDurationRequest
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.future.future
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import java.util.concurrent.CompletableFuture

/**
 * ===== ШАГИ ИЗ HEALTH CONNECT =====
 *
 * Свой счётчик (StepStore) читает датчик, только пока приложение открыто:
 * с Android 9 фоновым приложениям события датчика шагов не приходят, даже
 * по будильнику. Поэтому шаги по часам берём из Health Connect — туда их
 * пишут Samsung Health (с телефона и часов) и, на Android 14+, сам телефон.
 * Читаем при открытии меню, только суммы (aggregate — без двойного счёта,
 * если источников несколько), только чтение. Данные из Health Connect
 * остаются в телефоне, как и всё про шаги.
 *
 * Kotlin здесь из-за API на корутинах; Java (StepsPlugin) получает
 * CompletableFuture.
 */
object StepsHealth {
    const val READ_STEPS = "android.permission.health.READ_STEPS"

    /** available | update (надо обновить Health Connect) | unavailable */
    @JvmStatic
    fun status(ctx: Context): String = when (HealthConnectClient.getSdkStatus(ctx)) {
        HealthConnectClient.SDK_AVAILABLE -> "available"
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update"
        else -> "unavailable"
    }

    /** Системный экран запроса разрешения на чтение шагов. */
    @JvmStatic
    fun permissionIntent(ctx: Context): Intent =
        PermissionController.createRequestPermissionResultContract().createIntent(ctx, setOf(READ_STEPS))

    /** Настройки Health Connect — если разрешение уже отклонено и система больше не спрашивает. */
    @JvmStatic
    fun settingsIntent(): Intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)

    /**
     * Шаги: по часам — за сегодня и вчера, по дням — за последние days дней.
     * null — разрешения нет.
     */
    @JvmStatic
    fun read(ctx: Context, days: Int): CompletableFuture<JSONObject?> = CoroutineScope(Dispatchers.IO).future {
        val client = HealthConnectClient.getOrCreate(ctx)
        if (READ_STEPS !in client.permissionController.getGrantedPermissions()) return@future null
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val hours = JSONObject()
        for (back in 0L..1L) {
            val day = today.minusDays(back)
            val arr = LongArray(24)
            val res = client.aggregateGroupByDuration(
                AggregateGroupByDurationRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(day.atStartOfDay(zone).toInstant(), day.plusDays(1).atStartOfDay(zone).toInstant()),
                    timeRangeSlicer = Duration.ofHours(1),
                )
            )
            // в день перевода часов два отрезка попадают в один час — складываем
            for (b in res) arr[b.startTime.atZone(zone).hour] += b.result[StepsRecord.COUNT_TOTAL] ?: 0L
            hours.put(day.toString(), JSONArray(arr.toList()))
        }
        val history = JSONObject()
        val byDay = client.aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(today.minusDays(days - 1L).atStartOfDay(), today.plusDays(1).atStartOfDay()),
                timeRangeSlicer = Period.ofDays(1),
            )
        )
        for (b in byDay) history.put(b.startTime.toLocalDate().toString(), b.result[StepsRecord.COUNT_TOTAL] ?: 0L)
        JSONObject().put("hours", hours).put("history", history)
    }
}
