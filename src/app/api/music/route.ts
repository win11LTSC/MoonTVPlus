/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

// 服务器端内存缓存
const serverCache = {
  methodConfigs: new Map<string, { data: any; timestamp: number }>(),
  proxyRequests: new Map<string, { data: any; timestamp: number }>(),
  CACHE_DURATION: 24 * 60 * 60 * 1000, // 24小时缓存
};

// 获取 TuneHub 配置
async function getTuneHubConfig() {
  const config = await getConfig();
  const siteConfig = config?.SiteConfig;

  const enabled = siteConfig?.TuneHubEnabled ?? false;
  const baseUrl =
    siteConfig?.TuneHubBaseUrl ||
    process.env.TUNEHUB_BASE_URL ||
    'https://tunehub.sayqz.com/api';
  const apiKey = siteConfig?.TuneHubApiKey || process.env.TUNEHUB_API_KEY || '';

  return { enabled, baseUrl, apiKey };
}

// 通用请求处理函数
async function proxyRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    return response;
  } catch (error) {
    console.error('TuneHub API 请求失败:', error);
    throw error;
  }
}

// GET 请求处理
export async function GET(request: NextRequest) {
  try {
    const { enabled, baseUrl } = await getTuneHubConfig();

    if (!enabled) {
      return NextResponse.json(
        { error: '音乐功能未开启' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (!action) {
      return NextResponse.json(
        { error: '缺少 action 参数' },
        { status: 400 }
      );
    }

    // 处理不同的 action
    switch (action) {
      case 'methods': {
        // 获取所有平台方法
        const cacheKey = 'methods-all';
        const cached = serverCache.methodConfigs.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          console.log('使用缓存: methods');
          return NextResponse.json(cached.data);
        }

        const response = await proxyRequest(`${baseUrl}/v1/methods`);
        const data = await response.json();

        serverCache.methodConfigs.set(cacheKey, {
          data,
          timestamp: Date.now(),
        });

        return NextResponse.json(data);
      }

      case 'platform-methods': {
        // 获取指定平台的方法
        const platform = searchParams.get('platform');
        if (!platform) {
          return NextResponse.json(
            { error: '缺少 platform 参数' },
            { status: 400 }
          );
        }

        const cacheKey = `platform-methods-${platform}`;
        const cached = serverCache.methodConfigs.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          console.log(`使用缓存: platform-methods-${platform}`);
          return NextResponse.json(cached.data);
        }

        const response = await proxyRequest(`${baseUrl}/v1/methods/${platform}`);
        const data = await response.json();

        serverCache.methodConfigs.set(cacheKey, {
          data,
          timestamp: Date.now(),
        });

        return NextResponse.json(data);
      }

      case 'method-config': {
        // 获取指定平台指定方法的配置
        const platform = searchParams.get('platform');
        const func = searchParams.get('function');
        if (!platform || !func) {
          return NextResponse.json(
            { error: '缺少 platform 或 function 参数' },
            { status: 400 }
          );
        }

        const cacheKey = `method-config-${platform}-${func}`;
        const cached = serverCache.methodConfigs.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          console.log(`使用缓存: method-config-${platform}-${func}`);
          return NextResponse.json(cached.data);
        }

        const response = await proxyRequest(
          `${baseUrl}/v1/methods/${platform}/${func}`
        );
        const data = await response.json();

        serverCache.methodConfigs.set(cacheKey, {
          data,
          timestamp: Date.now(),
        });

        return NextResponse.json(data);
      }

      case 'proxy': {
        // 代理上游平台请求（用于方法下发后的实际请求）
        const targetUrl = searchParams.get('url');
        if (!targetUrl) {
          return NextResponse.json(
            { error: '缺少 url 参数' },
            { status: 400 }
          );
        }

        // 使用完整 URL 作为缓存键
        const cacheKey = `proxy-${targetUrl}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          console.log(`使用缓存: proxy request`);
          return NextResponse.json(cached.data);
        }

        // 获取其他查询参数
        const params = new URLSearchParams();
        searchParams.forEach((value, key) => {
          if (key !== 'action' && key !== 'url') {
            params.append(key, value);
          }
        });

        const fullUrl = params.toString()
          ? `${targetUrl}?${params.toString()}`
          : targetUrl;

        const response = await proxyRequest(fullUrl);
        const data = await response.json();

        serverCache.proxyRequests.set(cacheKey, {
          data,
          timestamp: Date.now(),
        });

        return NextResponse.json(data);
      }

      default:
        return NextResponse.json(
          { error: '不支持的 action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('音乐 API 错误:', error);
    return NextResponse.json(
      {
        error: '请求失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

// POST 请求处理（用于解析歌曲）
export async function POST(request: NextRequest) {
  try {
    const { enabled, baseUrl, apiKey } = await getTuneHubConfig();

    if (!enabled) {
      return NextResponse.json(
        { error: '音乐功能未开启' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json(
        { error: '缺少 action 参数' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'parse': {
        // 解析歌曲（需要 API Key）
        if (!apiKey) {
          return NextResponse.json(
            {
              code: -1,
              error: '未配置 TuneHub API Key',
              message: '未配置 TuneHub API Key'
            },
            { status: 403 }
          );
        }

        const { platform, ids, quality } = body;
        if (!platform || !ids) {
          return NextResponse.json(
            {
              code: -1,
              error: '缺少 platform 或 ids 参数',
              message: '缺少 platform 或 ids 参数'
            },
            { status: 400 }
          );
        }

        try {
          const response = await proxyRequest(`${baseUrl}/v1/parse`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey,
            },
            body: JSON.stringify({
              platform,
              ids,
              quality: quality || '320k',
            }),
          });

          const data = await response.json();
          console.log('TuneHub 解析响应:', data);

          // 如果 TuneHub 返回错误，包装成统一格式
          if (!response.ok || data.code !== 0) {
            return NextResponse.json({
              code: data.code || -1,
              message: data.message || data.error || '解析失败',
              error: data.error || data.message || '解析失败',
            });
          }

          return NextResponse.json(data);
        } catch (error) {
          console.error('解析歌曲失败:', error);
          return NextResponse.json({
            code: -1,
            message: '解析请求失败',
            error: (error as Error).message,
          });
        }
      }

      case 'proxy-post': {
        // 代理 POST 请求到上游平台
        const { url, data: postData, headers } = body;
        if (!url) {
          return NextResponse.json(
            { error: '缺少 url 参数' },
            { status: 400 }
          );
        }

        const response = await proxyRequest(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify(postData),
        });

        const responseData = await response.json();
        return NextResponse.json(responseData);
      }

      default:
        return NextResponse.json(
          { error: '不支持的 action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('音乐 API 错误:', error);
    return NextResponse.json(
      {
        error: '请求失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
