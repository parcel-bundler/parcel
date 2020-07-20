<template>
  <div>
    <child></child>
    docs: {{docs.standard}}
    in brief: {{docs.brief}}
  </div>
</template>

<script>
import Child from './Child.vue';
export default {
  components: {
    child: Child
  },
  data() {
    return {
      docs: {
        standard: Child.__docs,
        brief: Child.__docsBrief
      }
    }
  }
}
</script>