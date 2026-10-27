const config = require('../config/services')

function serviceError(message, code, statusCode) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

async function request(path, { method = 'GET', data = {} } = {}) {
  if (!wx.cloud || typeof wx.cloud.callContainer !== 'function') {
    throw serviceError('当前微信版本不支持云托管，请升级微信后重试。', 'UNSUPPORTED')
  }
  const query = method === 'GET'
    ? Object.keys(data)
      .filter((key) => data[key] !== undefined && data[key] !== null)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
      .join('&')
    : ''
  let response
  try {
    response = await wx.cloud.callContainer({
      config: { env: config.containerEnvId },
      path: `${config.apiPrefix}${path}${query ? `?${query}` : ''}`,
      method,
      header: {
        'X-WX-SERVICE': config.containerService,
        'tenant-id': config.tenantId,
        'content-type': 'application/json'
      },
      ...(method === 'GET' ? {} : { data }),
      timeout: config.requestTimeout
    })
  } catch (error) {
    throw serviceError('无法连接预约服务，请检查网络或稍后重试。', 'NETWORK_ERROR')
  }
  let body = response.data
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch (error) {
      throw serviceError('预约服务返回格式异常，请稍后重试。', 'INVALID_RESPONSE', response.statusCode)
    }
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = response.statusCode === 429 ? '操作过于频繁，请稍后重试。' : '预约服务暂时不可用，请稍后重试。'
    throw serviceError((body && body.msg) || message, body && body.code, response.statusCode)
  }
  if (!body || typeof body.code !== 'number') {
    throw serviceError('预约服务返回格式异常，请稍后重试。', 'INVALID_RESPONSE')
  }
  if (body.code !== 0) throw serviceError(body.msg || '操作失败，请稍后重试。', body.code, response.statusCode)
  return body.data
}

module.exports = { request, serviceError }
