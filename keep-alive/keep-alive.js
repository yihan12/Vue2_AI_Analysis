/*
 * keep-alive.js
 * 该文件实现了 Vue 的内置组件 keep-alive。
 * keep-alive 用于缓存动态组件，避免重复渲染和销毁，提高性能。
 * 支持 include/exclude 规则进行缓存控制，支持最大缓存数 max。
 * 该文件为 Vue 源码实现，包含缓存管理、组件生命周期钩子等。
 */

/* @flow */

// 引入工具函数 isRegExp（判断是否为正则表达式）、remove（从数组移除元素）
import { isRegExp, remove } from 'shared/util'
// 引入获取第一个子组件节点的工具函数
import { getFirstComponentChild } from 'core/vdom/helpers/index'

// VNodeCache 类型定义（Flow 类型，JS 环境可忽略）
type VNodeCache = { [key: string]: ?VNode };

// 获取组件名称
function getComponentName (opts: ?VNodeComponentOptions): ?string {
  // 如果有 options.name 则返回，否则返回 tag
  return opts && (opts.Ctor.options.name || opts.tag)
}

// 判断组件名是否匹配 include/exclude 规则
function matches (pattern: string | RegExp | Array<string>, name: string): boolean {
  if (Array.isArray(pattern)) {
    // 如果是数组，判断 name 是否在数组中
    return pattern.indexOf(name) > -1
  } else if (typeof pattern === 'string') {
    // 如果是字符串，按逗号分割后判断 name 是否在其中
    return pattern.split(',').indexOf(name) > -1
  } else if (isRegExp(pattern)) {
    // 如果是正则表达式，测试 name 是否匹配
    return pattern.test(name)
  }
  /* istanbul ignore next */
  // 其他情况返回 false
  return false
}

// 清理缓存，移除不符合 filter 的缓存组件
function pruneCache (keepAliveInstance: any, filter: Function) {
  const { cache, keys, _vnode } = keepAliveInstance
  for (const key in cache) {
    const cachedNode: ?VNode = cache[key]
    if (cachedNode) {
      const name: ?string = getComponentName(cachedNode.componentOptions)
      if (name && !filter(name)) {
        // 如果组件名不符合过滤条件，则移除缓存
        pruneCacheEntry(cache, key, keys, _vnode)
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
  const cached = cache[key]
  // 如果缓存存在，且不是当前正在渲染的 vnode，则销毁组件实例
  if (cached && (!current || cached.tag !== current.tag)) {
    cached.componentInstance.$destroy()
  }
  // 移除缓存
  cache[key] = null
  // 从 keys 数组中移除 key
  remove(keys, key)
}

// 定义支持的 pattern 类型：字符串、正则、数组
const patternTypes: Array<Function> = [String, RegExp, Array]

export default {
  // 组件名
  name: 'keep-alive',
  // 抽象组件，不会渲染为 DOM 元素
  abstract: true,

  // 组件 props
  props: {
    // include/exclude 支持字符串、正则、数组
    include: patternTypes,
    exclude: patternTypes,
    // 最大缓存数
    max: [String, Number]
  },

  // 创建时初始化缓存对象和 key 列表
  created () {
    this.cache = Object.create(null)
    this.keys = []
  },

  // 销毁时清理所有缓存
  destroyed () {
    for (const key in this.cache) {
      pruneCacheEntry(this.cache, key, this.keys)
    }
  },

  // 挂载后监听 include/exclude 变化，动态清理缓存
  mounted () {
    this.$watch('include', val => {
      pruneCache(this, name => matches(val, name))
    })
    this.$watch('exclude', val => {
      pruneCache(this, name => !matches(val, name))
    })
  },

  // 渲染函数，核心缓存逻辑
  render () {
    // 获取默认插槽内容
    const slot = this.$slots.default
    // 获取第一个子组件 vnode
    const vnode: VNode = getFirstComponentChild(slot)
    // 获取组件选项
    const componentOptions: ?VNodeComponentOptions = vnode && vnode.componentOptions
    if (componentOptions) {
      // 检查 include/exclude 规则
      const name: ?string = getComponentName(componentOptions)
      const { include, exclude } = this
      if (
        // 不在 include 中
        (include && (!name || !matches(include, name))) ||
        // 在 exclude 中
        (exclude && name && matches(exclude, name))
      ) {
        // 不缓存，直接返回 vnode
        return vnode
      }

      const { cache, keys } = this
      // 生成缓存 key，优先用 vnode.key，否则用 cid+tag
      const key: ?string = vnode.key == null
        // 同一个构造器可能注册为不同组件，cid 不唯一
        ? componentOptions.Ctor.cid + (componentOptions.tag ? `::${componentOptions.tag}` : '')
        : vnode.key
      if (cache[key]) {
        // 命中缓存，复用组件实例
        vnode.componentInstance = cache[key].componentInstance
        // 更新 key 顺序，保持最新
        remove(keys, key)
        keys.push(key)
      } else {
        // 未命中缓存，加入缓存
        cache[key] = vnode
        keys.push(key)
        // 超出最大缓存数，移除最早的缓存
        if (this.max && keys.length > parseInt(this.max)) {
          pruneCacheEntry(cache, keys[0], keys, this._vnode)
        }
      }

      // 标记为 keepAlive
      vnode.data.keepAlive = true
    }
    // 返回 vnode 或插槽第一个节点
    return vnode || (slot && slot[0])
  }
}
