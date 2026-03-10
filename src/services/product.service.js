const ProductModel = require('../models/product.model');
const VariantModel = require('../models/variant.model');
const EmbeddingModel = require('../models/embedding.model');

class ProductService {
  async getProducts(filters) {
    return ProductModel.findAll(filters);
  }

  async getProductById(id) {
    const product = await ProductModel.findById(id);
    if (!product) return null;

    const variants = await VariantModel.findByProductId(id);
    const embeddings = await EmbeddingModel.findByProductId(id);

    return {
      ...product,
      variants,
      embeddings: embeddings.map(e => ({
        type: e.embedding_type,
        model: e.model,
        created_at: e.created_at
      }))
    };
  }
}

module.exports = new ProductService();
