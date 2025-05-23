/*
 * keep-alive.js
 * 该文件实现了 Vue 的内置组件 keep-alive。
 * keep-alive 用于缓存动态组件，避免重复渲染和销毁，提高性能。
 * 支持 include/exclude 规则进行缓存控制，支持最大缓存数 max。
 * 该文件为 Vue 源码实现，包含缓存管理、组件生命周期钩子等。
 */

/* @flow */

// 引入工具函数 isRegExp（判断是否为正则表达式）、remove（从数组移除元素）
import { isRegExp, remove } from 'shared/util' // 引入工具函数 isRegExp 和 remove
// 引入获取第一个子组件节点的工具函数
import { getFirstComponentChild } from 'core/vdom/helpers/index' // 引入获取第一个子组件节点的工具函数

// VNodeCache 类型定义（Flow 类型，JS 环境可忽略）
type VNodeCache = { [key: string]: ?VNode }; // Flow 类型，JS 环境可忽略

// 获取组件名称
function getComponentName (opts: ?VNodeComponentOptions): ?string {// 获取组件名称，参数为组件选项对象
  // 如果有 options.name 则返回，否则返回 tag
  return opts && (opts.Ctor.options.name || opts.tag) // 优先返回组件名，否则返回标签名
}

// 判断组件名是否匹配 include/exclude 规则
function matches (pattern: string | RegExp | Array<string>, name: string): boolean { // 判断 name 是否匹配 pattern
  if (Array.isArray(pattern)) { // 如果 pattern 是数组
    // 如果是数组，判断 name 是否在数组中
    return pattern.indexOf(name) > -1 // name 在数组中返回 true
  } else if (typeof pattern === 'string') { // 如果 pattern 是字符串
    // 如果是字符串，按逗号分割后判断 name 是否在其中
    return pattern.split(',').indexOf(name) > -1 // name 在分割后的数组中返回 true
  } else if (isRegExp(pattern)) { // 如果 pattern 是正则表达式
    // 如果是正则表达式，测试 name 是否匹配
    return pattern.test(name) // 匹配返回 true
  }
  /* istanbul ignore next */
  // 其他情况返回 false
  return false // 其他情况返回 false
}

// 清理缓存，移除不符合 filter 的缓存组件
function pruneCache (keepAliveInstance: any, filter: Function) { // 清理缓存，参数为 keepAlive 实例和过滤函数
  const { cache, keys, _vnode } = keepAliveInstance // 解构获取缓存对象、key 列表和当前 vnode
  for (const key in cache) { // 遍历缓存对象
    const cachedNode: ?VNode = cache[key] // 获取缓存的 vnode
    if (cachedNode) { // 如果缓存存在
      const name: ?string = getComponentName(cachedNode.componentOptions) // 获取组件名
      if (name && !filter(name)) { // 如果组件名不符合过滤条件
        // 如果组件名不符合过滤条件，则移除缓存
        pruneCacheEntry(cache, key, keys, _vnode) // 移除该缓存项
      }
    }
  }
}

// 移除单个缓存项
function pruneCacheEntry (
  cache: VNodeCache,
  key: string,
  keys: Array<string>,
  current?: VNode
) {
  const cached = cache[key] // 获取缓存项
  // 如果缓存存在，且不是当前正在渲染的 vnode，则销毁组件实例
  if (cached && (!current || cached.tag !== current.tag)) { // 判断是否需要销毁实例
    cached.componentInstance.$destroy() // 销毁组件实例
  }
  // 移除缓存
  cache[key] = null // 将缓存项设为 null
  // 从 keys 数组中移除 key
  remove(keys, key) // 移除 key
}

// 定义支持的 pattern 类型：字符串、正则、数组
const patternTypes: Array<Function> = [String, RegExp, Array] // 支持的类型

export default {
  // 组件名
  name: 'keep-alive', // 组件名称
  // 抽象组件，不会渲染为 DOM 元素
  abstract: true, // 抽象组件

  // 组件 props
  props: {
    // include/exclude 支持字符串、正则、数组
    include: patternTypes, // include 属性
    exclude: patternTypes, // exclude 属性
    // 最大缓存数
    max: [String, Number] // max 属性，最大缓存数
  },

  // 创建时初始化缓存对象和 key 列表
  created () { // created 钩子
    this.cache = Object.create(null) // 初始化缓存对象
    this.keys = [] // 初始化 key 列表
  },

  // 销毁时清理所有缓存
  destroyed () { // destroyed 钩子
    for (const key in this.cache) { // 遍历所有缓存
      pruneCacheEntry(this.cache, key, this.keys) // 移除缓存项
    }
  },

  // 挂载后监听 include/exclude 变化，动态清理缓存
  mounted () { // mounted 钩子
    this.$watch('include', val => { // 监听 include 变化
      pruneCache(this, name => matches(val, name)) // 清理不符合的新 include 的缓存
    })
    this.$watch('exclude', val => { // 监听 exclude 变化
      pruneCache(this, name => !matches(val, name)) // 清理新 exclude 的缓存
    })
  },

  // 渲染函数，核心缓存逻辑
  render () { // 渲染函数
    // 获取默认插槽内容
    const slot = this.$slots.default // 获取默认插槽
    // 获取第一个子组件 vnode
    const vnode: VNode = getFirstComponentChild(slot) // 获取第一个子组件 vnode
    // 获取组件选项
    const componentOptions: ?VNodeComponentOptions = vnode && vnode.componentOptions // 获取组件选项
    if (componentOptions) { // 如果有组件选项
      // 检查 include/exclude 规则
      const name: ?string = getComponentName(componentOptions)// 获取组件名
      const { include, exclude } = this // 获取 include/exclude
      if (
        // 不在 include 中
        (include && (!name || !matches(include, name))) || // 不在 include 中
        // 在 exclude 中
        (exclude && name && matches(exclude, name)) // 在 exclude 中
      ) {
        // 不缓存，直接返回 vnode
        return vnode // 直接返回 vnode
      }

      const { cache, keys } = this // 获取缓存和 key 列表
      // 生成缓存 key，优先用 vnode.key，否则用 cid+tag
      const key: ?string = vnode.key == null
        // 同一个构造器可能注册为不同组件，cid 不唯一
        ? componentOptions.Ctor.cid + (componentOptions.tag ? `::${componentOptions.tag}` : '') // 生成 key
        : vnode.key // 使用 vnode.key
      if (cache[key]) { // 如果已缓存
        // 命中缓存，复用组件实例
        vnode.componentInstance = cache[key].componentInstance // 复用组件实例
        // 更新 key 顺序，保持最新
        remove(keys, key) // 移除旧 key
        keys.push(key) // 添加到末尾
      } else {
        // 未命中缓存，加入缓存
        cache[key] = vnode // 加入缓存
        keys.push(key) // 添加 key
        // 超出最大缓存数，移除最早的缓存
        if (this.max && keys.length > parseInt(this.max)) { // 超出最大缓存数
          pruneCacheEntry(cache, keys[0], keys, this._vnode) // 移除最早的缓存
        }
      }

      // 标记为 keepAlive
      vnode.data.keepAlive = true // 标记 keepAlive
    }
    // 返回 vnode 或插槽第一个节点
    return vnode || (slot && slot[0]) // 返回 vnode 或第一个插槽节点
  }
}
