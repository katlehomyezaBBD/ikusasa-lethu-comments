const API_BASE_URL = 'http://localhost:3000/api';

  /**
   * Get all comments for a specific site
   * @param {string} site - The site identifier (e.g., 'homepage', 'about-page')
   * @returns {Promise<Array>} Array of comment objects
   */
  export async function getComments(site) {
    if (!site) {
      throw new Error('Site parameter is required');
    }

    const url = `${API_BASE_URL}/comments?site=${encodeURIComponent(site)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Student-Number': this.studentNumber,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get comments');
    }

    return await response.json();
  }

  /**
   * Post a new comment to a site
   * @param {string} site - The site identifier
   * @param {string} text - The comment text (max 280 characters)
   * @param {string} sender - Optional sender name
   * @returns {Promise<Object>} The created comment object
   */
  export async function postComment(site, text, sender = 'Anonymous') {
    if (!site || !text) {
      throw new Error('Site and text are required');
    }

    if (text.length > 280) {
      throw new Error('Comment text must be 280 characters or less');
    }

    const url = `${API_BASE_URL}/comments`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Student-Number': this.studentNumber,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ site, text, sender })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to post comment');
    }

    return await response.json();
  }

  /**
   * Delete a comment by ID
   * @param {string} site - The site identifier
   * @param {string} commentId - The ID of the comment to delete
   * @returns {Promise<Object>} Success message
   */
  export async function deleteComment(site, commentId) {
    if (!site || !commentId) {
      throw new Error('Site and commentId are required');
    }

    const url = `${API_BASE_URL}/comments/${commentId}?site=${encodeURIComponent(site)}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'X-Student-Number': this.studentNumber,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete comment');
    }

    return await response.json();
  }
module.exports = { getComments, postComment, deleteComment };

