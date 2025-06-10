# 超详细手写 keep-alive 实现与原理剖析

下面我将从内核机制到每一行代码实现，全方位深度解析 keep-alive 的工作原理，并提供更完整的实现版本。

## 一、核心机制深度解析

### 1.1 缓存管理三维模型

```
                   ┌───────────────────────┐
                   │      Cache Store      │
                   │                       │
                   │  ┌─────┐  ┌─────┐     │
                   │  │ C1  │  │ C2  │ ... │
                   │  └─────┘  └─────┘     │
                   └───────────┬───────────┘
                               │
               ┌───────────────▼────────────────┐
               │          LRU Controller        │
               │                                │
               │  ┌─────┐  ┌─────┐  ┌─────┐    │
               │  │ K1  │  │ K2  │  │ K3  │    │
               │  └─────┘  └─────┘  └─────┘    │
               └───────────────┬────────────────┘
                               │
               ┌───────────────▼────────────────┐
               │   Lifecycle Hooks Manager      │
               │                                │
               │  ┌─────────────────────────┐   │
               │  │  activated/deactivated  │   │
               │  └─────────────────────────┘   │
               └────────────────────────────────┘
```

### 1.2 缓存键生成算法

```javascript
function generateCacheKey(vnode) {
  // 优先级: 用户定义key > 组件cid + tag > 纯cid
  return vnode.key ?? 
         `${vnode.componentOptions.Ctor.cid}${vnode.componentOptions.tag ? `::${vnode.componentOptions.tag}` : ''}`
}
```

### 1.3 完整生命周期流程图

```
  ┌───────────────────────────────────────────────────────────────────────────────┐
  │                                KeepAlive Component                            │
  └───────────────────────┬───────────────────────────────────┬───────────────────┘
                          │                                   │
┌─────────────────────────▼─────────────────────────┐ ┌───────▼───────────────────┐
│                     Mount Phase                   │ │     Update Phase          │
│                                                   │ │                           │
│ 1. 创建缓存对象(cache)和LRU队列(keys)               │ │ 1. 监听include/exclude变化│
│ 2. 初始化首次渲染                                  │ │ 2. 动态修剪缓存            │
│ 3. 标记keepAlive=true                             │ │ 3. 调整LRU顺序             │
└─────────────────────────┬─────────────────────────┘ └───────┬───────────────────┘
                          │                                   │
┌─────────────────────────▼─────────────────────────┐ ┌───────▼───────────────────┐
│                     Cache Hit                     │ │      Cache Miss           │
│                                                   │ │                           │
│ 1. 从cache获取实例                                 │ │ 1. 创建新缓存条目          │
│ 2. 调整keys队列顺序                                │ │ 2. 检查max限制             │
│ 3. 触发activated钩子                               │ │ 3. 执行LRU淘汰             │
└───────────────────────────────────────────────────┘ └───────────────────────────┘
```

## 二、增强版实现代码

```javascript
class KeepAlive {
  static install(Vue) {
    Vue.component('keep-alive', {
      name: 'keep-alive',
      abstract: true,
      
      props: {
        include: { type: [String, RegExp, Array], default: null },
        exclude: { type: [String, RegExp, Array], default: null },
        max: { type: [String, Number], default: null }
      },

      created() {
        this._cache = new Map()       // 使用Map替代Object提高性能
        this._keys = new Set()       // 使用Set实现LRU队列
        this._vnodeCache = new WeakMap() // 使用WeakMap存储VNode引用
      },

      destroyed() {
        this._cache.forEach(cached => {
          this._destroyComponent(cached.component)
        })
        this._cache.clear()
        this._keys.clear()
      },

      mounted() {
        this._setupWatchers()
      },

      render() {
        const rawVNode = this._getRawVNode()
        if (!rawVNode) return null
        
        const vnode = this._cloneVNode(rawVNode)
        const cacheKey = this._getCacheKey(vnode)
        
        if (this._shouldCache(vnode)) {
          if (this._cache.has(cacheKey)) {
            this._handleCacheHit(vnode, cacheKey)
          } else {
            this._handleCacheMiss(vnode, cacheKey)
          }
          vnode.data.keepAlive = true
        }
        
        return vnode
      },

      // 私有方法
      _getRawVNode() {
        const slot = this.$slots.default
        return slot && slot.find(vnode => 
          vnode.tag && vnode.componentOptions
        )
      },

      _cloneVNode(vnode) {
        const cloned = new VNode(
          vnode.tag,
          vnode.data,
          vnode.children,
          vnode.text,
          vnode.elm,
          vnode.context,
          vnode.componentOptions,
          vnode.asyncFactory
        )
        cloned.key = vnode.key
        return cloned
      },

      _getCacheKey(vnode) {
        return vnode.key ?? 
          `${vnode.componentOptions.Ctor.cid}::${vnode.componentOptions.tag || ''}`
      },

      _shouldCache(vnode) {
        const name = this._getComponentName(vnode)
        if (!name) return false
        
        const { include, exclude } = this
        return !(
          (include && !this._matchPattern(include, name)) ||
          (exclude && this._matchPattern(exclude, name))
        )
      },

      _getComponentName(vnode) {
        return vnode.componentOptions.Ctor.options.name ||
               vnode.componentOptions.tag
      },

      _matchPattern(pattern, name) {
        if (Array.isArray(pattern)) {
          return pattern.some(p => this._matchSinglePattern(p, name))
        }
        return this._matchSinglePattern(pattern, name)
      },

      _matchSinglePattern(pattern, name) {
        if (typeof pattern === 'string') {
          return pattern.split(',').includes(name)
        } else if (pattern instanceof RegExp) {
          return pattern.test(name)
        }
        return false
      },

      _handleCacheHit(vnode, cacheKey) {
        const cached = this._cache.get(cacheKey)
        vnode.componentInstance = cached.component
        this._refreshLRU(cacheKey)
        this._callHook(cached.component, 'activated')
      },

      _handleCacheMiss(vnode, cacheKey) {
        this._cache.set(cacheKey, {
          component: null,  // 将在patch阶段填充
          timestamp: Date.now()
        })
        this._keys.add(cacheKey)
        this._enforceMaxCache()
      },

      _refreshLRU(cacheKey) {
        this._keys.delete(cacheKey)
        this._keys.add(cacheKey)
      },

      _enforceMaxCache() {
        if (!this.max) return
        
        const max = parseInt(this.max)
        while (this._keys.size > max) {
          const oldestKey = this._keys.values().next().value
          this._pruneCacheEntry(oldestKey)
        }
      },

      _pruneCacheEntry(cacheKey) {
        const cached = this._cache.get(cacheKey)
        if (cached) {
          this._destroyComponent(cached.component)
          this._cache.delete(cacheKey)
          this._keys.delete(cacheKey)
        }
      },

      _destroyComponent(component) {
        if (component) {
          component.$destroy()
          this._callHook(component, 'deactivated')
        }
      },

      _callHook(component, hook) {
        if (component && component.$options[hook]) {
          component.$options[hook].forEach(h => h.call(component))
        }
      },

      _setupWatchers() {
        const updateCache = (val, oldVal) => {
          if (val !== oldVal) {
            this._pruneCache(name => this._matchPattern(val, name))
          }
        }
        
        this.$watch('include', updateCache)
        this.$watch('exclude', (val, oldVal) => {
          if (val !== oldVal) {
            this._pruneCache(name => !this._matchPattern(val, name))
          }
        })
      },

      _pruneCache(filter) {
        this._cache.forEach((cached, key) => {
          const name = this._getComponentName(this._vnodeCache.get(key))
          if (name && !filter(name)) {
            this._pruneCacheEntry(key)
          }
        })
      }
    })
  }
}
```

## 三、关键机制深度剖析

### 3.1 LRU算法优化实现

```javascript
class LRUCache {
  constructor(maxSize) {
    this._map = new Map()
    this._maxSize = maxSize
  }

  get(key) {
    if (!this._map.has(key)) return undefined
    
    // 刷新为最近使用
    const value = this._map.get(key)
    this._map.delete(key)
    this._map.set(key, value)
    return value
  }

  set(key, value) {
    // 如果已存在，先删除
    if (this._map.has(key)) {
      this._map.delete(key)
    }
    
    // 设置新值
    this._map.set(key, value)
    
    // 执行淘汰
    if (this._map.size > this._maxSize) {
      // Map的keys()是按插入顺序的迭代器
      const oldestKey = this._map.keys().next().value
      this._map.delete(oldestKey)
    }
  }
}
```

### 3.2 生命周期钩子触发原理

```javascript
// 在Vue的patch.js中
function createComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
  let i = vnode.data
  if (isDef(i)) {
    // 检查keepAlive标记
    const isReactivated = isDef(vnode.componentInstance) && i.keepAlive
    if (isDef(i = i.hook) && isDef(i = i.init)) {
      i(vnode, false /* hydrating */)
    }
    
    if (isDef(vnode.componentInstance)) {
      // 处理keep-alive组件
      if (isReactivated) {
        reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
      }
      return true
    }
  }
}

function reactivateComponent(vnode, queue, parent, ref) {
  // 执行激活前准备
  prepatch(vnode, vnode)
  
  // 触发activated钩子
  const innerNode = vnode.componentInstance._vnode
  if (innerNode.data.keepAlive) {
    queueActivatedComponent(vnode.componentInstance)
  }
}
```

### 3.3 缓存持久化策略

```javascript
// 扩展KeepAlive支持本地存储持久化
const PersistentKeepAlive = {
  extends: KeepAlive,
  
  props: {
    persistKey: String,
    storage: {
      type: Object,
      default: () => localStorage
    }
  },

  created() {
    this._loadPersistedState()
  },

  methods: {
    _loadPersistedState() {
      if (!this.persistKey) return
      
      try {
        const state = JSON.parse(this.storage.getItem(this.persistKey))
        if (state) {
          this._cache = new Map(state.cache)
          this._keys = new Set(state.keys)
        }
      } catch (e) {
        console.warn('Failed to load persisted keep-alive state', e)
      }
    },

    _saveState() {
      if (!this.persistKey) return
      
      this.storage.setItem(this.persistKey, JSON.stringify({
        cache: Array.from(this._cache.entries()),
        keys: Array.from(this._keys)
      }))
    },

    _pruneCacheEntry(key) {
      KeepAlive.methods._pruneCacheEntry.call(this, key)
      this._saveState()
    },

    _handleCacheMiss(vnode, key) {
      KeepAlive.methods._handleCacheMiss.call(this, vnode, key)
      this._saveState()
    }
  }
}
```

## 四、性能优化技巧

1. **缓存命中率优化**：
   ```javascript
   // 动态调整缓存策略
   function adaptiveCacheStrategy() {
     const hitRate = cacheHits / (cacheHits + cacheMisses)
     if (hitRate < 0.3) {
       // 降低缓存数量
       this.max = Math.floor(this.max * 0.8)
     } else if (hitRate > 0.7) {
       // 增加缓存数量
       this.max = Math.ceil(this.max * 1.2)
     }
   }
   ```

2. **内存泄漏防护**：
   ```javascript
   // 定时清理陈旧缓存
   setInterval(() => {
     const now = Date.now()
     this._cache.forEach((cached, key) => {
       if (now - cached.timestamp > 30 * 60 * 1000) { // 30分钟
         this._pruneCacheEntry(key)
       }
     })
   }, 5 * 60 * 1000) // 每5分钟检查一次
   ```

3. **预加载策略**：
   ```javascript
   // 预加载可能需要的组件
   function prefetchComponents(components) {
     components.forEach(component => {
       const vnode = createComponentVNode(component)
       const key = this._getCacheKey(vnode)
       if (!this._cache.has(key)) {
         this._handleCacheMiss(vnode, key)
       }
     })
   }
   ```

这个增强版实现不仅包含了基础功能，还引入了性能优化、持久化存储等高级特性，完整展现了生产级 keep-alive 的实现思路。
