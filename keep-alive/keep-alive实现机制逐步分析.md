# Vue2 keep-alive 实现机制逐步解析

下面我将按照实现步骤详细解释`keep-alive`的工作原理，结合源码分析其实现机制。

## 第一步：组件定义与初始化

### 1. 抽象组件标记
```javascript
abstract: true
```
- `keep-alive`被标记为抽象组件，这意味着：
  - 不会渲染为实际的DOM元素
  - 不会出现在父组件链中
  - 不会触发常规的组件生命周期钩子

### 2. 初始化缓存结构
在`created`钩子中：
```javascript
this.cache = Object.create(null)  // 纯净的缓存对象，无原型链
this.keys = []                   // 缓存键的访问顺序记录
```
- `cache`对象用于存储组件VNode实例
- `keys`数组用于实现LRU(最近最少使用)算法

## 第二步：渲染过程处理

### 1. 获取待缓存组件
```javascript
const slot = this.$slots.default
const vnode = getFirstComponentChild(slot)
```
- 只处理默认插槽中的**第一个**组件节点
- 通过`getFirstComponentChild`找到第一个有效的组件VNode

### 2. 缓存条件检查
```javascript
const name = getComponentName(componentOptions)
if (
  (include && (!name || !matches(include, name))) ||
  (exclude && name && matches(exclude, name))
) {
  return vnode
}
```
- 检查组件是否匹配`include`/`exclude`规则
- 不匹配则直接返回原始VNode，不进行缓存

### 3. 缓存键生成
```javascript
const key = vnode.key == null
  ? componentOptions.Ctor.cid + (componentOptions.tag ? `::${componentOptions.tag}` : '')
  : vnode.key
```
- 优先使用组件自身的`key`
- 无`key`时使用组件构造函数cid + tag组合生成唯一键

## 第三步：缓存管理实现

### 1. 缓存命中处理
```javascript
if (cache[key]) {
  vnode.componentInstance = cache[key].componentInstance
  remove(keys, key)
  keys.push(key)
}
```
- 从缓存中获取组件实例
- 更新该key在`keys`数组中的位置（移至末尾）
- 实现LRU算法的"最近使用"特性

### 2. 新缓存添加
```javascript
else {
  cache[key] = vnode
  keys.push(key)
  if (this.max && keys.length > parseInt(this.max)) {
    pruneCacheEntry(cache, keys[0], keys, this._vnode)
  }
}
```
- 将新VNode加入缓存
- 检查缓存数量是否超过`max`限制
- 超过则删除`keys[0]`对应的最久未使用缓存

### 3. 缓存标记
```javascript
vnode.data.keepAlive = true
```
- 这个标记会在后续patch过程中被识别
- 用于触发特殊的组件激活/停用逻辑

## 第四步：缓存清理机制

### 1. 主动清理函数
```javascript
function pruneCacheEntry(cache, key, keys, current) {
  const cached = cache[key]
  if (cached && (!current || cached.tag !== current.tag)) {
    cached.componentInstance.$destroy()
  }
  cache[key] = null
  remove(keys, key)
}
```
- 销毁组件实例，释放资源
- 从缓存对象和keys数组中移除对应项
- 会跳过当前正在使用的组件

### 2. 响应式清理
```javascript
this.$watch('include', val => {
  pruneCache(this, name => matches(val, name))
})
this.$watch('exclude', val => {
  pruneCache(this, name => !matches(val, name))
})
```
- 监听include/exclude变化
- 动态清理不符合条件的缓存

## 第五步：与Vue核心的协作

### 1. 组件激活流程
在patch过程中：
```javascript
// src/core/vdom/create-component.js
if (isReactivated) {
  reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
}
```
- 对于缓存的组件，会调用`reactivateComponent`
- 最终触发`activateChildComponent`，进而调用`activated`钩子

### 2. 组件停用流程
```javascript
// src/core/instance/lifecycle.js
export function deactivateChildComponent(vm, direct) {
  vm._inactive = true
  callHook(vm, 'deactivated')
}
```
- 组件被缓存时触发停用
- 设置_inactive标志并调用`deactivated`钩子

## 第六步：特殊场景处理

### 1. 嵌套组件处理
```javascript
// activateChildComponent中
for (let i = 0; i < vm.$children.length; i++) {
  activateChildComponent(vm.$children[i])
}
```
- 递归激活所有子组件
- 确保嵌套组件也能正确触发生命周期

### 2. 最大缓存限制
```javascript
if (this.max && keys.length > parseInt(this.max)) {
  pruneCacheEntry(cache, keys[0], keys, this._vnode)
}
```
- 精确控制内存使用
- 避免缓存过多组件导致内存泄漏

## 设计亮点总结

1. **LRU缓存策略**：通过keys数组维护访问顺序，高效管理缓存
2. **轻量级标记系统**：仅用`keepAlive`布尔标记控制缓存逻辑
3. **精确生命周期控制**：通过改写组件hook实现特殊生命周期
4. **响应式缓存管理**：监听include/exclude动态调整缓存
5. **内存安全**：严格限制缓存数量，组件销毁时清理所有缓存

这种实现方式既保证了缓存的效率，又确保了内存使用的安全性，是Vue组件系统的重要优化手段。
