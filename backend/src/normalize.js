// Shapes both the hosted weatherstack response and the mokapi mock response
// (which mirrors weatherstack's schema) into one contract for the frontend.
// Classification is by HTTP status only: 2xx -> success, everything else -> error.
export function normalizeWeatherResponse(httpStatus, body) {
    if (httpStatus >= 200 && httpStatus < 300) {
        return {
            status: 'success',
            city: body?.location?.name,
            temperatureF: body?.current?.temperature
        }
    }

    return {
        status: 'error',
        httpStatusCode: httpStatus,
        errorCode: body?.error?.code ?? null,
        errorInfo: body?.error?.info ?? 'Unknown error'
    }
}
