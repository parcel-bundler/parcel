<template>
  <div class="small">
    Hello {{hello}}!
    <last-component />
  </div>
</template>
<script>
import LastComponent from './Final.vue'
export default {
  components: {
    'last-component': LastComponent
  },
  data() {
    return {
      hello: 'there'
    }
  }
}
</script>