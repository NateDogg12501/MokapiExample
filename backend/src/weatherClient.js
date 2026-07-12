export async function fetchWeather(baseUrl, accessKey, city) {
    const url = new URL(baseUrl)
    url.searchParams.set('access_key', accessKey)
    url.searchParams.set('query', city)
    url.searchParams.set('units', 'f')

    const res = await fetch(url)
    const body = await res.json()
    return { httpStatus: res.status, body }
}
